import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  TextField,
  Typography,
} from "@mui/material";

import SendIcon from "@mui/icons-material/Send";
import MenuIcon from "@mui/icons-material/Menu";
import DeleteIcon from "@mui/icons-material/Delete";
import UploadFileIcon from "@mui/icons-material/UploadFile";

import DashboardLayout from "../layouts/DashboardLayout";

import { createSession, deleteSession, getSessions } from "../api/sessionApi";
import { askQuestion } from "../api/chatApi";
import { deleteMessage, getSessionMessages } from "../api/historyApi";
import { getDocuments } from "../api/documentApi";

import UserMessage from "../components/chat/UserMessage";
import AIMessage from "../components/chat/AIMessage";
import TypingLoader from "../components/chat/TypingLoader";
import SourceCard from "../components/chat/SourceCard";
import SessionSidebar from "../components/chat/SessionSidebar";

import { useToast } from "../context/ToastContext";
import ErrorState from "../components/common/ErrorState";

function normalizeList(data) {
  if (Array.isArray(data)) return data;
  return data?.items || data?.data || data?.results || [];
}

function getErrorMessage(error, fallbackMessage) {
  return (
    error.response?.data?.detail ||
    error.response?.data?.message ||
    fallbackMessage
  );
}

function Chat() {
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialSessionId = searchParams.get("session_id") || "";
  const initialDocumentId = searchParams.get("document_id") || "";

  const bottomRef = useRef(null);

  const [sessions, setSessions] = useState([]);
  const [documents, setDocuments] = useState([]);

  const [activeSessionId, setActiveSessionId] = useState(initialSessionId);

  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");

  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [createChatDialogOpen, setCreateChatDialogOpen] = useState(false);
  const [newChatTitle, setNewChatTitle] = useState("");

  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const activeSession = useMemo(
    () =>
      sessions.find(
        (session) => Number(session.id) === Number(activeSessionId)
      ),
    [sessions, activeSessionId]
  );

  const sessionDocuments = useMemo(
    () =>
      documents.filter(
        (document) => Number(document.session_id) === Number(activeSessionId)
      ),
    [documents, activeSessionId]
  );

  const activeSources = useMemo(() => {
    const latestAIMessage = [...messages]
      .reverse()
      .find((message) => message.role === "assistant" || message.type === "ai");

    return latestAIMessage?.sources || [];
  }, [messages]);

  const scrollToBottom = () => {
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  const loadSessions = async () => {
    try {
      setLoadingSessions(true);
      setError("");

      const data = await getSessions();
      const sessionList = normalizeList(data);

      setSessions(sessionList);

      // If no active session is set and no session in URL params
      if (!activeSessionId && sessionList.length > 0) {
        // Try to use session from URL params if available
        const sessionIdFromParams = searchParams.get("session_id");
        
        if (sessionIdFromParams) {
          // Session is already set from URL params via initial state
          setActiveSessionId(sessionIdFromParams);
        } else {
          // Load the most recent session (first in the list)
          const firstSessionId = sessionList[0].id;
          setActiveSessionId(firstSessionId);
          setSearchParams({ session_id: firstSessionId });
        }
      }
    } catch (error) {
      const message = getErrorMessage(error, "Failed to load chat sessions.");
      setError(message);
      showToast(message, "error");
    } finally {
      setLoadingSessions(false);
    }
  };

  const loadDocuments = async () => {
    try {
      const data = await getDocuments();
      setDocuments(normalizeList(data));
    } catch (error) {
      const message = getErrorMessage(error, "Failed to load documents.");
      showToast(message, "error");
    }
  };

  const loadMessages = async (sessionId) => {
    if (!sessionId) {
      setMessages([]);
      return;
    }

    try {
      setLoadingMessages(true);
      setError("");

      const data = await getSessionMessages(sessionId);
      const messageList = normalizeList(data);

      const normalizedMessages = [];

      messageList.forEach((message) => {
        // Each ChatMessage from backend has both question and answer
        // Split them into separate user and AI messages

        // Add user message
        if (message.question) {
          normalizedMessages.push({
            id: `${message.id}-user`,
            role: "user",
            content: message.question,
            sources: [],
            created_at: message.created_at,
          });
        }

        // Add AI message
        if (message.answer) {
          normalizedMessages.push({
            id: `${message.id}-assistant`,
            role: "assistant",
            content: message.answer,
            sources: message.sources || message.source_references || [],
            created_at: message.created_at,
          });
        }
      });

      setMessages(normalizedMessages);
      scrollToBottom();
    } catch (error) {
      const message = getErrorMessage(error, "Failed to load chat messages.");
      setError(message);
      showToast(message, "error");
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    loadSessions();
    loadDocuments();
  }, []);

  useEffect(() => {
    if (activeSessionId) {
      loadMessages(activeSessionId);
    }
  }, [activeSessionId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending]);

  const handleRetry = () => {
    loadSessions();
    loadDocuments();

    if (activeSessionId) {
      loadMessages(activeSessionId);
    }
  };

  const handleSelectSession = (sessionId) => {
    setActiveSessionId(sessionId);
    setError("");
    setSuccessMessage("");

    setSearchParams({
      session_id: sessionId,
    });

    setMobileSidebarOpen(false);
  };

  const handleCreateSessionClick = () => {
    setNewChatTitle("");
    setCreateChatDialogOpen(true);
  };

  const handleCreateSessionConfirm = async () => {
    const title = newChatTitle.trim() || "New Chat";

    try {
      setError("");
      setSuccessMessage("");
      setCreateChatDialogOpen(false);

      const newSession = await createSession(title);

      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      setMessages([]);

      setSearchParams({
        session_id: newSession.id,
      });

      const message = `Chat session "${title}" created.`;
      setSuccessMessage(message);
      showToast(message, "success");

      setMobileSidebarOpen(false);
    } catch (error) {
      const message = getErrorMessage(
        error,
        "Failed to create new chat session."
      );
      setError(message);
      showToast(message, "error");
    }

    setNewChatTitle("");
  };

  const handleCreateSessionCancel = () => {
    setCreateChatDialogOpen(false);
    setNewChatTitle("");
  };

  const handleDeleteSession = async (sessionId) => {
    const confirmDelete = window.confirm(
      "Are you sure you want to delete this chat session?"
    );

    if (!confirmDelete) return;

    try {
      setError("");
      setSuccessMessage("");

      await deleteSession(sessionId);

      const updatedSessions = sessions.filter(
        (session) => Number(session.id) !== Number(sessionId)
      );

      setSessions(updatedSessions);

      if (Number(activeSessionId) === Number(sessionId)) {
        const nextSession = updatedSessions[0];

        if (nextSession) {
          setActiveSessionId(nextSession.id);
          setSearchParams({ session_id: nextSession.id });
        } else {
          setActiveSessionId("");
          setMessages([]);
          setSearchParams({});
        }
      }

      const message = "Chat session deleted successfully.";
      setSuccessMessage(message);
      showToast(message, "success");
    } catch (error) {
      const message = getErrorMessage(
        error,
        "Failed to delete chat session."
      );
      setError(message);
      showToast(message, "error");
    }
  };

  const handleDeleteMessage = async (messageId) => {
    if (!messageId) return;

    const confirmDelete = window.confirm(
      "Are you sure you want to delete this message?"
    );

    if (!confirmDelete) return;

    try {
      await deleteMessage(messageId);

      setMessages((prev) => prev.filter((message) => message.id !== messageId));
      showToast("Message deleted successfully.", "success");
    } catch (error) {
      const message = getErrorMessage(error, "Failed to delete message.");
      setError(message);
      showToast(message, "error");
    }
  };

  const handleSendQuestion = async (event) => {
    event.preventDefault();

    const trimmedQuestion = question.trim();

    if (!trimmedQuestion) return;

    if (!activeSessionId) {
      const message = "Please create or select a chat session first.";
      setError(message);
      showToast(message, "error");
      return;
    }

    const tempUserMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmedQuestion,
      sources: [],
    };

    setMessages((prev) => [...prev, tempUserMessage]);
    setQuestion("");
    setSending(true);
    setError("");
    setSuccessMessage("");

    try {
      const data = await askQuestion({
        sessionId: activeSessionId,
        documentId: null, // Always use all session documents
        question: trimmedQuestion,
      });

      const aiMessage = {
        id: data.message_id || `ai-${Date.now()}`,
        role: "assistant",
        content:
          data.answer ||
          data.response ||
          data.message ||
          "No answer returned from backend.",
        sources: data.sources || data.source_references || [],
      };

      setMessages((prev) => [...prev, aiMessage]);
      showToast("Answer generated successfully.", "success");
    } catch (error) {
      const backendMessage = getErrorMessage(
        error,
        "Failed to get answer from backend."
      );

      const errorAIMessage = {
        id: `ai-error-${Date.now()}`,
        role: "assistant",
        content: backendMessage,
        sources: [],
      };

      setMessages((prev) => [...prev, errorAIMessage]);
      setError(backendMessage);
      showToast(backendMessage, "error");
    } finally {
      setSending(false);
    }
  };

  const renderMessage = (message) => {
    const isUser =
      message.role === "user" ||
      message.role === "human" ||
      message.type === "user";

    return (
      <div
        key={message.id || `${message.role}-${Math.random()}`}
        className="group relative"
      >
        {isUser ? (
          <UserMessage message={message} />
        ) : (
          <AIMessage message={message} />
        )}

        {message.id &&
          !String(message.id).startsWith("user-") &&
          !String(message.id).startsWith("ai-") && (
            <IconButton
              size="small"
              color="error"
              className="absolute right-2 top-0 opacity-0 transition group-hover:opacity-100"
              onClick={() => handleDeleteMessage(message.id)}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          )}
      </div>
    );
  };

  return (
    <DashboardLayout>
      <Box className="flex h-[calc(100vh-9rem)] overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="hidden lg:block">
          <SessionSidebar
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectSession}
            onCreateSession={handleCreateSessionClick}
            onDeleteSession={handleDeleteSession}
          />
        </div>

        <Drawer
          open={mobileSidebarOpen}
          onClose={() => setMobileSidebarOpen(false)}
          className="lg:hidden"
        >
          <SessionSidebar
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectSession}
            onCreateSession={handleCreateSessionClick}
            onDeleteSession={handleDeleteSession}
          />
        </Drawer>

        <Box className="flex min-w-0 flex-1 flex-col bg-slate-50">
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <IconButton
                className="lg:hidden"
                onClick={() => setMobileSidebarOpen(true)}
              >
                <MenuIcon />
              </IconButton>

              <div className="min-w-0">
                <Typography variant="h6" className="truncate font-bold">
                  {activeSession?.title || "Select or create a chat"}
                </Typography>

                <Typography variant="body2" color="text.secondary">
                  {activeSessionId
                    ? `Session ID: ${activeSessionId}`
                    : "No active session"}
                </Typography>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                component={Link}
                to="/documents/upload"
                variant="outlined"
                size="small"
                startIcon={<UploadFileIcon />}
              >
                Upload
              </Button>

              <Button
                variant="contained"
                size="small"
                onClick={handleCreateSessionClick}
              >
                New Chat
              </Button>
            </div>
          </div>

          {(error || successMessage) && (
            <div className="border-b border-slate-200 bg-white px-5 py-3">
              {error && <ErrorState message={error} onRetry={handleRetry} />}

              {successMessage && (
                <Alert severity="success">{successMessage}</Alert>
              )}
            </div>
          )}

          {activeSessionId && (
            <div className="border-b border-slate-200 bg-white px-5 py-3">
              <div className="mb-3">
                <Typography variant="subtitle2" className="mb-2 font-semibold text-slate-700">
                  📄 Documents in this Chat
                </Typography>

                {sessionDocuments.length === 0 ? (
                  <div className="rounded-xl border-2 border-dashed border-orange-300 bg-orange-50 p-4">
                    <Typography variant="body2" className="text-orange-900">
                      ⚠️ No documents uploaded yet. Please upload documents to this chat session before asking questions.
                    </Typography>

                    <Button
                      component={Link}
                      to="/documents/upload"
                      variant="outlined"
                      size="small"
                      startIcon={<UploadFileIcon />}
                      className="mt-2"
                    >
                      Upload Document
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sessionDocuments.map((document) => {
                      const filename =
                        document.original_filename ||
                        document.filename ||
                        document.file_name ||
                        `Document ${document.id}`;

                      const fileSize = document.file_size
                        ? `${(document.file_size / 1024).toFixed(2)} KB`
                        : "Unknown size";

                      return (
                        <div
                          key={document.id}
                          className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
                        >
                          <div className="flex h-8 w-8 items-center justify-center rounded bg-indigo-100 text-indigo-700 text-sm font-semibold">
                            📄
                          </div>

                          <div className="min-w-0 flex-1">
                            <Typography variant="body2" className="truncate font-semibold">
                              {filename}
                            </Typography>

                            <Typography variant="caption" color="text.secondary">
                              {fileSize}
                            </Typography>
                          </div>
                        </div>
                      );
                    })}

                    <Button
                      component={Link}
                      to="/documents/upload"
                      variant="outlined"
                      size="small"
                      startIcon={<UploadFileIcon />}
                      fullWidth
                      className="mt-2"
                    >
                      Upload More Documents
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-5">
            {loadingSessions || loadingMessages ? (
              <Box className="flex h-full items-center justify-center">
                <CircularProgress />
              </Box>
            ) : !activeSessionId ? (
              <Box className="flex h-full flex-col items-center justify-center text-center">
                <Typography variant="h5" className="font-bold">
                  Start a new chat
                </Typography>

                <Typography color="text.secondary" className="mt-2 max-w-md">
                  Create a chat session first. Then upload documents inside that
                  session and ask questions from them.
                </Typography>

                <Button
                  variant="contained"
                  className="mt-5"
                  onClick={handleCreateSessionClick}
                >
                  Create New Chat
                </Button>
              </Box>
            ) : messages.length === 0 ? (
              <Box className="flex h-full flex-col items-center justify-center text-center">
                <Typography variant="h5" className="font-bold">
                  No messages yet
                </Typography>

                <Typography color="text.secondary" className="mt-2 max-w-md">
                  Ask your first question from documents uploaded in this chat
                  session.
                </Typography>

                <div className="mt-4 flex gap-2">
                  <Chip label="PDF" variant="outlined" />
                  <Chip label="TXT" variant="outlined" />
                  <Chip label="DOCX" variant="outlined" />
                </div>
              </Box>
            ) : (
              <>
                {messages.map(renderMessage)}
                {sending && <TypingLoader />}
                <div ref={bottomRef} />
              </>
            )}
          </div>

          <form
            onSubmit={handleSendQuestion}
            className="border-t border-slate-200 bg-white p-4"
          >
            <div className="flex gap-3">
              <TextField
                fullWidth
                multiline
                maxRows={4}
                placeholder="Ask a question from this chat session's uploaded documents..."
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                disabled={sending || !activeSessionId}
              />

              <Button
                type="submit"
                variant="contained"
                disabled={sending || !question.trim() || !activeSessionId}
                endIcon={<SendIcon />}
                className="min-w-28"
              >
                Send
              </Button>
            </div>
          </form>
        </Box>

        <Box className="hidden w-96 flex-col border-l border-slate-200 bg-white xl:flex">
          <div className="border-b border-slate-200 p-5">
            <Typography variant="h6" className="font-bold">
              Source References
            </Typography>

            <Typography variant="body2" color="text.secondary">
              Sources from the latest AI answer.
            </Typography>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {activeSources.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-center">
                <Typography className="font-semibold">No sources yet</Typography>

                <Typography
                  variant="body2"
                  color="text.secondary"
                  className="mt-1"
                >
                  Ask a question and retrieved document chunks will appear here.
                </Typography>
              </div>
            ) : (
              activeSources.map((source, index) => (
                <SourceCard key={index} source={source} index={index} />
              ))
            )}
          </div>
        </Box>
      </Box>

      <Dialog
        open={createChatDialogOpen}
        onClose={handleCreateSessionCancel}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create New Chat</DialogTitle>
        <DialogContent className="mt-4">
          <TextField
            autoFocus
            fullWidth
            label="Chat Title"
            placeholder="Enter a title for your chat session"
            value={newChatTitle}
            onChange={(e) => setNewChatTitle(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === "Enter") {
                handleCreateSessionConfirm();
              }
            }}
            helperText="Give your chat a meaningful name (e.g., 'Project Documentation', 'Q&A Session')"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCreateSessionCancel}>Cancel</Button>
          <Button
            onClick={handleCreateSessionConfirm}
            variant="contained"
            disabled={!newChatTitle.trim()}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </DashboardLayout>
  );
}

export default Chat;