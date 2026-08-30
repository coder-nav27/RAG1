from fastapi import HTTPException, status
from huggingface_hub import InferenceClient

from app.core.config import settings


def extract_context_from_prompt(prompt: str) -> str:
    """
    Extract document context section from RAG prompt.
    """
    if "Context:" in prompt:
        parts = prompt.split("Context:", 1)
        if len(parts) > 1:
            ctx_part = parts[1]
            if "Question:" in ctx_part:
                return ctx_part.split("Question:", 1)[0].strip()
            return ctx_part.strip()
    return prompt.strip()


def generate_answer_from_context_fallback(prompt: str) -> str:
    """
    Fallback answer generator when HF API token is unconfigured or fails.
    Extracts relevant document content directly from retrieved context.
    """
    if "RETRIEVED DOCUMENT CONTEXT:" in prompt:
        parts = prompt.split("RETRIEVED DOCUMENT CONTEXT:", 1)[1]
        if "RECENT CHAT HISTORY:" in parts:
            parts = parts.split("RECENT CHAT HISTORY:", 1)[0]
        elif "CURRENT USER QUESTION:" in parts:
            parts = parts.split("CURRENT USER QUESTION:", 1)[0]

        context_text = parts.strip()
        if context_text and "No relevant document context found" not in context_text:
            return f"Based on your uploaded document:\n\n{context_text}"

    return "I could not find this information in your uploaded documents."


def generate_answer_with_huggingface(prompt: str) -> str:
    print("LLM service (generate answer with Hugging Face) -->")

    if not settings.HF_TOKEN or settings.HF_TOKEN == "your-huggingface-token":
        print("HF_TOKEN is default or missing. Using context fallback.")
        return generate_answer_from_context_fallback(prompt)

    try:
        client = InferenceClient(
            provider=settings.HF_INFERENCE_PROVIDER,
            api_key=settings.HF_TOKEN,
        )

        completion = client.chat.completions.create(
            model=settings.HF_LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a helpful RAG assistant. "
                        "Answer only from the provided uploaded document context. "
                        "If the answer is not in the context, say: "
                        "'I cannot find this information in your uploaded documents.'"
                    ),
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ],
            max_tokens=settings.LLM_MAX_TOKENS,
            temperature=settings.LLM_TEMPERATURE,
        )

        answer = completion.choices[0].message.content

        if answer and answer.strip():
            return answer.strip()

    except Exception as e:
        print(f"Hugging Face LLM call failed: {e}. Falling back to extracted context.")

    return generate_answer_from_context_fallback(prompt)


def generate_answer_from_prompt(prompt: str) -> str:
    print("LLM service (generate answer from prompt) -->")

    if settings.LLM_PROVIDER == "huggingface":
        return generate_answer_with_huggingface(prompt)

    return generate_answer_from_context_fallback(prompt)