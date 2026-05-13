from fastapi import HTTPException, status
from huggingface_hub import InferenceClient

from app.core.config import settings


def get_huggingface_client() -> InferenceClient:
    if not settings.HF_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="HF_TOKEN is missing. Add it in your .env file."
        )

    return InferenceClient(
        provider=settings.HF_INFERENCE_PROVIDER,
        api_key=settings.HF_TOKEN,
    )


def generate_answer_with_huggingface(prompt: str) -> str:
    print("LLM service (generate answer with Hugging Face) -->")
    """
    Generate answer using Hugging Face Inference Providers.

    Model:
    meta-llama/Llama-3.1-8B-Instruct

    Provider:
    novita
    """

    try:
        client = get_huggingface_client()

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

        if not answer or not answer.strip():
            return "I could not generate an answer right now."

        return answer.strip()

    except Exception as e:
        error_text = str(e)

        if "402" in error_text or "Payment Required" in error_text:
            return (
                "The relevant document content was found, but Hugging Face provider billing/credits "
                "are required for this model/provider."
            )

        if "401" in error_text or "Unauthorized" in error_text:
            return (
                "The relevant document content was found, but Hugging Face authentication failed. "
                "Please check your HF_TOKEN."
            )

        if "403" in error_text or "gated" in error_text.lower():
            return (
                "The relevant document content was found, but access to this Llama model is blocked. "
                "Please accept the model license on Hugging Face and check your token permissions."
            )

        if "429" in error_text or "rate" in error_text.lower():
            return (
                "The relevant document content was found, but Hugging Face rate limit was reached. "
                "Please try again later."
            )

        return f"Hugging Face LLM generation failed: {error_text}"


def generate_answer_from_prompt(prompt: str) -> str:
    print("LLM service (generate answer from prompt) -->")
    """
    Main function used by chat_service.py.

    This keeps your existing RAG code unchanged.
    """

    if settings.LLM_PROVIDER == "huggingface":
        return generate_answer_with_huggingface(prompt)

    return "No valid LLM provider configured."