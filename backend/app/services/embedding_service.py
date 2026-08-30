from typing import List

from fastapi import HTTPException, status
from huggingface_hub import InferenceClient
from sentence_transformers import SentenceTransformer

from app.core.config import settings


class HuggingFaceBGEEmbeddings:
    """
    LangChain-compatible embedding wrapper for Hugging Face Inference API.
    """

    def __init__(self):
        if not settings.HF_TOKEN or settings.HF_TOKEN == "your-huggingface-token":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="HF_TOKEN is missing or default in .env file."
            )

        self.client = InferenceClient(
            provider=settings.HF_EMBEDDING_PROVIDER,
            api_key=settings.HF_TOKEN,
        )

        self.model = settings.HF_EMBEDDING_MODEL

    def _normalize_embedding_response(self, response):
        if hasattr(response, "tolist"):
            response = response.tolist()
        return response

    def embed_query(self, text: str) -> List[float]:
        try:
            response = self.client.feature_extraction(
                text,
                model=self.model,
            )

            response = self._normalize_embedding_response(response)

            if response and isinstance(response[0], list):
                return response[0]

            return response

        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Hugging Face query embedding failed: {str(e)}"
            )

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        try:
            embeddings = []

            for text in texts:
                response = self.client.feature_extraction(
                    text,
                    model=self.model,
                )

                response = self._normalize_embedding_response(response)

                if response and isinstance(response[0], list):
                    embeddings.append(response[0])
                else:
                    embeddings.append(response)

            return embeddings

        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Hugging Face document embedding failed: {str(e)}"
            )


class LocalBGEEmbeddings:
    """
    LangChain-compatible local embedding wrapper using SentenceTransformer.
    Runs 100% locally without requiring any API keys.
    """

    _model_instance = None

    def __init__(self):
        if LocalBGEEmbeddings._model_instance is None:
            try:
                # Use fast, lightweight 90MB local embedding model
                LocalBGEEmbeddings._model_instance = SentenceTransformer("all-MiniLM-L6-v2")
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Local embedding model loading failed: {str(e)}"
                )
        self.model = LocalBGEEmbeddings._model_instance

    def embed_query(self, text: str) -> List[float]:
        try:
            embedding = self.model.encode(
                text,
                normalize_embeddings=True
            )
            return embedding.tolist()
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Local query embedding failed: {str(e)}"
            )

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        try:
            embeddings = self.model.encode(
                texts,
                normalize_embeddings=True,
                batch_size=8
            )
            return embeddings.tolist()
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Local document embedding failed: {str(e)}"
            )


def get_embedding_model():
    """
    Main embedding model used by ChromaDB.
    Prefers local embedding if HF_TOKEN is default or unconfigured.
    """
    if settings.EMBEDDING_PROVIDER in ["local", "local_huggingface", "sentence_transformers"]:
        return LocalBGEEmbeddings()

    if settings.EMBEDDING_PROVIDER == "huggingface":
        if not settings.HF_TOKEN or settings.HF_TOKEN == "your-huggingface-token":
            return LocalBGEEmbeddings()
        try:
            return HuggingFaceBGEEmbeddings()
        except Exception:
            return LocalBGEEmbeddings()

    return LocalBGEEmbeddings()


def test_embedding_model(text: str):
    embeddings = get_embedding_model()
    vector = embeddings.embed_query(text)
    return vector