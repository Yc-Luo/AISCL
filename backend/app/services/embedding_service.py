"""Embedding service with MiniMax support and admin-configurable settings."""

import logging
from dataclasses import dataclass
from typing import List, Optional

import httpx

from app.core.config import settings
from app.repositories.system_config import SystemConfig

logger = logging.getLogger(__name__)


@dataclass
class EmbeddingRuntimeConfig:
    """Runtime embedding configuration resolved from admin DB and env."""

    provider: str
    api_key: str
    base_url: str
    model: str
    embedding_type: str
    group_id: str = ""
    dimensions: Optional[int] = None


def _is_real_secret(value: Optional[str]) -> bool:
    """Avoid treating masked UI placeholders as usable API keys."""
    return bool(value and "•••" not in value and value.strip())


class EmbeddingService:
    """Generate text embeddings through an external provider."""

    @staticmethod
    async def _get_config_value(key: str) -> Optional[str]:
        """Read one system config value from the admin database."""
        try:
            config = await SystemConfig.find_one({"key": key})
        except Exception as exc:
            logger.debug("Embedding config lookup failed for %s: %s", key, exc)
            return None
        if not config:
            return None
        value = config.value.strip() if isinstance(config.value, str) else config.value
        return value or None

    @staticmethod
    def _parse_positive_int(value: Optional[str]) -> Optional[int]:
        """Parse optional positive integer config values."""
        if value is None:
            return None
        try:
            parsed = int(str(value).strip())
        except (TypeError, ValueError):
            return None
        return parsed if parsed > 0 else None

    @staticmethod
    async def _resolve_config() -> EmbeddingRuntimeConfig:
        """Resolve embedding settings.

        The admin panel owns the `embedding_*` keys. Environment variables remain
        the fallback so deployments can still boot before an administrator saves
        the first database configuration.
        """
        provider = (
            await EmbeddingService._get_config_value("embedding_provider")
            or settings.EMBEDDING_PROVIDER
        ).lower()
        db_key = await EmbeddingService._get_config_value("embedding_key")
        api_key = (
            db_key
            if _is_real_secret(db_key)
            else (settings.MINIMAX_API_KEY or settings.OPENAI_API_KEY)
        )
        return EmbeddingRuntimeConfig(
            provider=provider,
            api_key=api_key,
            base_url=(
                await EmbeddingService._get_config_value("embedding_base_url")
                or settings.MINIMAX_EMBEDDING_BASE_URL
            ),
            model=(
                await EmbeddingService._get_config_value("embedding_model")
                or settings.MINIMAX_EMBEDDING_MODEL
            ),
            embedding_type=(
                await EmbeddingService._get_config_value("embedding_type")
                or settings.MINIMAX_EMBEDDING_TYPE
            ),
            group_id=(
                await EmbeddingService._get_config_value("embedding_group_id")
                or settings.MINIMAX_GROUP_ID
            ),
            dimensions=(
                EmbeddingService._parse_positive_int(
                    await EmbeddingService._get_config_value("embedding_dimensions")
                )
                or settings.EMBEDDING_DIMENSIONS
            ),
        )

    @staticmethod
    async def is_enabled() -> bool:
        """Return whether embedding calls are configured."""
        if not settings.RAG_VECTOR_ENABLED:
            return False
        config = await EmbeddingService._resolve_config()
        if config.provider in {"minimax", "openai", "openai_compatible", "openai-compatible"}:
            return bool(config.api_key)
        return False

    @staticmethod
    async def embed_text(text: str, *, purpose: Optional[str] = "query") -> Optional[List[float]]:
        """Embed one text string."""
        vectors = await EmbeddingService.embed_texts([text], purpose=purpose)
        return vectors[0] if vectors else None

    @staticmethod
    async def embed_texts(texts: List[str], *, purpose: Optional[str] = None) -> List[List[float]]:
        """Embed a batch of text strings."""
        cleaned_texts = [text.strip() for text in texts if text and text.strip()]
        if not cleaned_texts:
            return []

        config = await EmbeddingService._resolve_config()
        if not settings.RAG_VECTOR_ENABLED:
            return []
        if config.provider == "minimax" and config.api_key:
            return await EmbeddingService._embed_with_minimax(
                cleaned_texts,
                config=config,
                purpose=purpose,
            )
        if (
            config.provider in {"openai", "openai_compatible", "openai-compatible"}
            and config.api_key
        ):
            return await EmbeddingService._embed_with_openai_compatible(
                cleaned_texts,
                config=config,
            )

        logger.warning("Unsupported or incomplete embedding provider: %s", config.provider)
        return []

    @staticmethod
    def _resolve_embedding_endpoint(base_url: str) -> str:
        """Accept either a root /v1 URL or a full /embeddings endpoint."""
        endpoint = (base_url or "").rstrip("/")
        if endpoint.endswith("/embeddings"):
            return endpoint
        return f"{endpoint}/embeddings"

    @staticmethod
    async def _embed_with_minimax(
        texts: List[str],
        *,
        config: EmbeddingRuntimeConfig,
        purpose: Optional[str],
    ) -> List[List[float]]:
        """Call MiniMax embedding API.

        The endpoint and group-id handling are configurable because MiniMax has
        used multiple public hostnames across API generations.
        """
        params = {}
        if config.group_id:
            params["GroupId"] = config.group_id

        payload = {
            "model": config.model,
            "texts": texts,
            "type": purpose or config.embedding_type,
        }
        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                EmbeddingService._resolve_embedding_endpoint(config.base_url),
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
    async def _embed_with_openai_compatible(
        texts: List[str],
        *,
        config: EmbeddingRuntimeConfig,
    ) -> List[List[float]]:
        """Call OpenAI-compatible embedding APIs."""
        payload = {
            "model": config.model,
            "input": texts,
        }
        if config.dimensions:
            payload["dimensions"] = config.dimensions

        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                EmbeddingService._resolve_embedding_endpoint(config.base_url),
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()

        vectors = EmbeddingService._extract_vectors(data)
        if not vectors:
            logger.warning("OpenAI-compatible embedding response contained no vectors: %s", data)
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
