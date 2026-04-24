"""Qdrant-backed vector store for AISCL RAG."""

import logging
import uuid
from typing import Any, Dict, List, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class VectorStoreService:
    """Small Qdrant REST client with graceful degradation."""

    @staticmethod
    def is_enabled() -> bool:
        """Return whether vector storage is configured."""
        return bool(settings.RAG_VECTOR_ENABLED and settings.QDRANT_URL)

    @staticmethod
    def point_id(source_type: str, source_id: str, chunk_index: int) -> str:
        """Create a deterministic UUID point id for idempotent upserts."""
        raw = f"{source_type}:{source_id}:{chunk_index}"
        return str(uuid.uuid5(uuid.NAMESPACE_URL, raw))

    @staticmethod
    async def ensure_collection() -> bool:
        """Ensure the Qdrant collection exists."""
        if not VectorStoreService.is_enabled():
            return False

        headers = VectorStoreService._headers()
        collection_url = VectorStoreService._url(f"/collections/{settings.QDRANT_COLLECTION}")

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                get_response = await client.get(collection_url, headers=headers)
                if get_response.status_code == 200:
                    return True

                create_response = await client.put(
                    collection_url,
                    headers=headers,
                    json={
                        "vectors": {
                            "size": settings.QDRANT_VECTOR_SIZE,
                            "distance": "Cosine",
                        }
                    },
                )
                create_response.raise_for_status()
                return True
        except Exception as exc:
            logger.warning("Qdrant collection unavailable: %s", exc)
            return False

    @staticmethod
    async def upsert_points(points: List[Dict[str, Any]]) -> bool:
        """Upsert vector points into Qdrant."""
        if not points or not await VectorStoreService.ensure_collection():
            return False

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.put(
                    VectorStoreService._url(
                        f"/collections/{settings.QDRANT_COLLECTION}/points"
                    ),
                    headers=VectorStoreService._headers(),
                    json={"points": points},
                )
                response.raise_for_status()
                return True
        except Exception as exc:
            logger.warning("Qdrant upsert failed: %s", exc)
            return False

    @staticmethod
    async def search(
        vector: List[float],
        *,
        project_id: str,
        group_id: Optional[str] = None,
        stage_id: Optional[str] = None,
        source_types: Optional[List[str]] = None,
        item_types: Optional[List[str]] = None,
        limit: int = 5,
    ) -> List[Dict[str, Any]]:
        """Search vectors in Qdrant."""
        if not vector or limit <= 0 or not await VectorStoreService.ensure_collection():
            return []

        must_filters: List[Dict[str, Any]] = [
            {"key": "project_id", "match": {"value": project_id}},
        ]
        should_filters: List[Dict[str, Any]] = []
        if group_id:
            should_filters.extend([
                {"key": "visibility", "match": {"value": "project"}},
                {"key": "group_id", "match": {"value": group_id}},
            ])
        if stage_id:
            must_filters.append({"key": "stage_id", "match": {"value": stage_id}})
        if source_types:
            should_filters.extend(
                {"key": "source_type", "match": {"value": source_type}}
                for source_type in source_types
            )
        if item_types:
            should_filters.extend(
                {"key": "item_type", "match": {"value": item_type}}
                for item_type in item_types
            )

        query_filter: Dict[str, Any] = {"must": must_filters}
        if should_filters:
            query_filter["should"] = should_filters

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(
                    VectorStoreService._url(
                        f"/collections/{settings.QDRANT_COLLECTION}/points/search"
                    ),
                    headers=VectorStoreService._headers(),
                    json={
                        "vector": vector,
                        "filter": query_filter,
                        "limit": limit,
                        "with_payload": True,
                    },
                )
                response.raise_for_status()
                data = response.json()
        except Exception as exc:
            logger.warning("Qdrant search failed: %s", exc)
            return []

        return data.get("result", []) if isinstance(data, dict) else []

    @staticmethod
    def _headers() -> Dict[str, str]:
        """Build Qdrant request headers."""
        headers = {"Content-Type": "application/json"}
        if settings.QDRANT_API_KEY:
            headers["api-key"] = settings.QDRANT_API_KEY
        return headers

    @staticmethod
    def _url(path: str) -> str:
        """Build Qdrant URL."""
        return settings.QDRANT_URL.rstrip("/") + path


vector_store_service = VectorStoreService()
