from typing import List

from langchain_core.documents import Document as LangChainDocument

from app.models.chat_message import ChatMessage


def format_context(chunks: List[LangChainDocument]) -> str:
    if not chunks:
        return "No relevant context found."

    context_parts = []

    for index, chunk in enumerate(chunks, start=1):
        filename = chunk.metadata.get("filename", "unknown")
        chunk_index = chunk.metadata.get("chunk_index", "unknown")

        context_parts.append(
            f"""
[Context {index}]
Source File: {filename}
Chunk Index: {chunk_index}
Content:
{chunk.page_content}
"""
        )

    return "\n".join(context_parts)


def format_chat_history(messages: List[ChatMessage]) -> str:
    if not messages:
        return "No previous chat history."

    history_parts = []

    for message in messages:
        history_parts.append(
            f"""
User: {message.question}
Assistant: {message.answer}
"""
        )

    return "\n".join(history_parts)


def build_rag_prompt(
    document_context: str,
    history_context: str,
    current_question: str,
) -> str:
    print("prompt service (build rag prompt) -->")
    prompt = f"""
You are a helpful RAG assistant.

SYSTEM INSTRUCTION:
Answer the user's question using only the uploaded document context provided below.
Do not use outside knowledge.
Be clear, simple, and accurate.

SAFETY RULE:
If the answer is not available in the retrieved document context, say:
"I could not find this information in your uploaded documents."

RETRIEVED DOCUMENT CONTEXT:
{document_context if document_context else "No relevant document context found."}

RECENT CHAT HISTORY:
{history_context if history_context else "No recent chat history."}

CURRENT USER QUESTION:
{current_question}

ANSWER FORMATTING RULE:
- Give a direct answer first.
- Use bullet points if helpful.
- Mention source filenames when useful.
- Do not invent facts.
- If context is insufficient, say you could not find it in uploaded documents.

FINAL ANSWER:
"""
    print("Built raw prompt:",prompt.strip())
    return prompt.strip()