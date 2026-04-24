"""Embedding service with MiniMax support and safe fallback."""

import logging
from typing import List, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class EmbeddingService:
    """Generate text embeddings through an external provider."""

    @staticmethod
    def is_enabled() -> bool:
        """Return whether embedding calls are configured."""
        if not settings.RAG_VECTOR_ENABLED:
            return False
        provider = settings.EMBEDDING_PROVIDER.lower()
        if provider == "minimax":
            return bool(settings.MINIMAX_API_KEY)
        return False

    @staticmethod
    async def embed_text(text: str, *, purpose: str = "db") -> Optional[List[float]]:
        """Embed one text string."""
        vectors = await EmbeddingService.embed_texts([text], purpose=purpose)
        return vectors[0] if vectors else None

    @staticmethod
    async def embed_texts(texts: List[str], *, purpose: str = "db") -> List[List[float]]:
        """Embed a batch of text strings."""
        cleaned_texts = [text.strip() for text in texts if text and text.strip()]
        if not cleaned_texts or not EmbeddingService.is_enabled():
            return []

        provider = settings.EMBEDDING_PROVIDER.lower()
        if provider == "minimax":
            return await EmbeddingService._embed_with_minimax(cleaned_texts, purpose=purpose)

        logger.warning("Unsupported embedding provider: %s", settings.EMBEDDING_PROVIDER)
        return []

    @staticmethod
    async def _embed_with_minimax(texts: List[str], *, purpose: str) -> List[List[float]]:
        """Call MiniMax embedding API.

        The endpoint and group-id handling are configurable because MiniMax has
        used multiple public hostnames across API generations.
        """
        params = {}
        if settings.MINIMAX_GROUP_ID:
            params["GroupId"] = settings.MINIMAX_GROUP_ID

        payload = {
            "model": settings.MINIMAX_EMBEDDING_MODEL,
            "texts": texts,
            "type": purpose or settings.MINIMAX_EMBEDDING_TYPE,
        }
        headers = {
            "Authorization": f"Bearer {settings.MINIMAX_API_KEY}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                settings.MINIMAX_EMBEDDING_BASE_URL,
                params=params,
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()

        vectors = EmbeddingService._extract_vectors(data)
        if not vectors:
            logger.warning("MiniMax embedding response contained no vectors: %s", data)
        return vectors

    @staticmethod
    def _extract_vectors(data: dict) -> List[List[float]]:
        """Extract vectors from MiniMax-style or OpenAI-style responses."""
        if isinstance(data.get("vectors"), list):
            return data["vectors"]

        if isinstance(data.get("data"), list):
            vectors = []
            for item in data["data"]:
                if isinstance(item, dict) and isinstance(item.get("embedding"), list):
                    vectors.append(item["embedding"])
            if vectors:
                return vectors

        if isinstance(data.get("embeddings"), list):
            return data["embeddings"]

        return []


embedding_service = EmbeddingService()
