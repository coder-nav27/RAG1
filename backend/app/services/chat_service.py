from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.services.ownership_service import (
    validate_session_owner,
    validate_document_session_owner,
)
from app.services.rag_service import retrieve_user_chunks
from app.services.prompt_service import build_rag_prompt
from app.services.llm_service import generate_answer_from_prompt
from app.repositories.chat_repository import (
    get_recent_chat_messages,
    create_chat_message,
)
from app.repositories.document_repository import get_user_document_by_id

from app.services.context_service import (
    build_limited_rag_context,
    has_relevant_context,
    fallback_no_context_answer,
)

def build_sources_from_chunks(chunks):
    print("chat service (build sources from chunks) -->")
    sources = []

    for chunk in chunks:
        preview = chunk.page_content[:200].replace("\n", " ")
        print("Chunk preview:", preview)

        sources.append(
            {
                "document_id": chunk.metadata.get("document_id"),
                "filename": chunk.metadata.get("filename"),
                "chunk_index": chunk.metadata.get("chunk_index"),
                "similarity_score": chunk.metadata.get("similarity_score"),
                "preview": preview,
            }
        )
    print(f"Built sources from {len(chunks)} chunks")
    return sources


def get_default_collection_name(user_id: int) -> str:
    return f"user_{user_id}_documents"

def build_contexts_from_chunks(retrieved_chunks):
    """
    Convert retrieved ChromaDB chunks into RAGAS-compatible contexts.

    RAGAS expects:
    contexts = [
        "full chunk text 1",
        "full chunk text 2"
    ]
    """

    contexts = []

    for chunk in retrieved_chunks:
        if isinstance(chunk, dict):
            text = (
                chunk.get("page_content")
                or chunk.get("content")
                or chunk.get("text")
                or chunk.get("document")
                or chunk.get("preview")
                or ""
            )
        else:
            text = (
                getattr(chunk, "page_content", None)
                or getattr(chunk, "content", None)
                or getattr(chunk, "text", None)
                or getattr(chunk, "document", None)
                or ""
            )

        if text and text.strip():
            contexts.append(text.strip())

    return contexts

def ask_question_service(
    db: Session,
    current_user,
    session_id: int,
    question: str,
    document_id: int | None = None,
):
    # print("chat service-->")
    
    """
    Full RAG question-answering flow.

    1. Validate session ownership
    2. Optional document ownership validation
    3. Retrieve user-isolated chunks from ChromaDB
    4. Get recent chat history
    5. Build RAG prompt
    6. Generate answer using LLM
    7. Build sources
    8. Save chat message in SQL
    9. Return answer response
    """
    
    
    session = validate_session_owner(
        db=db,
        session_id=session_id,
        current_user_id=current_user.id
    )

    collection_name = get_default_collection_name(current_user.id)  
    # print(f"Using collection: {collection_name}")

    if document_id is not None:
        document = validate_document_session_owner(
            db=db,
            document_id=document_id,
            session_id=session_id,
            current_user_id=current_user.id
        )
        # print(document)
        collection_name = document.chroma_collection

        # print(collection_name)
    retrieved_chunks = retrieve_user_chunks(
        question=question,
        user_id=current_user.id,
        session_id=session_id,
        collection_name=collection_name,
        document_id=document_id,
        k=settings.RAG_TOP_K
    )

    recent_history = get_recent_chat_messages(
        db=db,
        user_id=current_user.id,
        session_id=session.id,
        limit=settings.MAX_HISTORY_MESSAGES
    )
    
     # ✅ Add this for RAGAS
    contexts = build_contexts_from_chunks(retrieved_chunks)

    if not has_relevant_context(retrieved_chunks):
        answer = fallback_no_context_answer()
        sources = []
    else:
        limited_context = build_limited_rag_context(
            chunks=retrieved_chunks,
            recent_messages=recent_history,
            current_question=question,
            max_document_context_chars=settings.MAX_DOCUMENT_CONTEXT_CHARS,
            max_history_context_chars=settings.MAX_HISTORY_CONTEXT_CHARS,
            max_question_chars=settings.MAX_QUESTION_CHARS,
        )
        # print("limited context", limited_context)

        prompt = build_rag_prompt(
            document_context=limited_context["document_context"],
            history_context=limited_context["history_context"],
            current_question=limited_context["current_question"],
        )
        # print("final prompt sent to LLM", prompt)
        answer = generate_answer_from_prompt(prompt)
        # print("LLM generated answer", answer)

        sources = build_sources_from_chunks(retrieved_chunks)
        # print(f"Built sources: {sources}")

    message = create_chat_message(
        db=db,
        user_id=current_user.id,
        session_id=session.id,
        document_id=document_id,
        question=question,
        answer=answer,
        sources=sources
    )

    return {
        "answer": answer,
        "sources": sources,
        "contexts": contexts,
        "session_id": session.id,
        "timestamp": message.created_at or datetime.now(timezone.utc),
    }    
    
    
    
    
    
    
    
