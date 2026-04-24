"""Project Wiki service for structured knowledge capture and retrieval."""

import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from app.repositories.wiki_item import WikiItem
from app.services.research_event_service import research_event_service


class WikiService:
    """Service for project Wiki operations."""

    @staticmethod
    def _to_response_dict(item: WikiItem) -> Dict[str, Any]:
        """Convert a Wiki item document to an API-friendly dict."""
        return {
            "id": str(item.id),
            "project_id": item.project_id,
            "group_id": item.group_id,
            "stage_id": item.stage_id,
            "item_type": item.item_type,
            "title": item.title,
            "content": item.content,
            "summary": item.summary,
            "source_type": item.source_type,
            "source_id": item.source_id,
            "source_event_ids": item.source_event_ids,
            "linked_item_ids": item.linked_item_ids,
            "created_by": item.created_by,
            "updated_by": item.updated_by,
            "visibility": item.visibility,
            "confidence_level": item.confidence_level,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
        }

    @staticmethod
    def _build_query(
        project_id: str,
        group_id: Optional[str] = None,
        item_type: Optional[str] = None,
        item_types: Optional[List[str]] = None,
        stage_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Build a Mongo query with project-level and optional group-level visibility."""
        query: Dict[str, Any] = {"project_id": project_id}
        if group_id:
            query["$or"] = [
                {"visibility": "project"},
                {"group_id": group_id},
            ]
        if item_type:
            query["item_type"] = item_type
        elif item_types:
            query["item_type"] = {"$in": item_types}
        if stage_id:
            query["stage_id"] = stage_id
        return query

    @staticmethod
    def _terms(query: str) -> List[str]:
        """Build lightweight search terms for Chinese and whitespace-separated text."""
        normalized = re.sub(r"\s+", " ", (query or "").strip().lower())
        if not normalized:
            return []
        terms = {normalized}
        for part in re.split(r"[\s,，。；;：:、!?！？()（）\"'“”]+", normalized):
            if len(part) >= 2:
                terms.add(part)
                if len(part) >= 6:
                    terms.update(part[i : i + 2] for i in range(0, len(part) - 1))
        return [term for term in terms if term]

    @staticmethod
    def _score_item(item: WikiItem, query: str) -> float:
        """Score an item with deterministic keyword matching."""
        terms = WikiService._terms(query)
        if not terms:
            return 0.0

        title = (item.title or "").lower()
        summary = (item.summary or "").lower()
        content = (item.content or "").lower()
        score = 0.0
        for term in terms:
            if term in title:
                score += 3.0
            if term in summary:
                score += 2.0
            if term in content:
                score += 1.0
        if item.item_type in {"task_brief", "evidence", "stage_summary"}:
            score += 0.2
        return score

    @staticmethod
    async def create_item(
        data: Dict[str, Any],
        *,
        current_user_id: str,
        actor_type: str = "student",
        record_event: bool = True,
    ) -> WikiItem:
        """Create a Wiki item and optionally record a research event."""
        now = datetime.utcnow()
        item = WikiItem(
            **data,
            created_by=current_user_id,
            updated_by=current_user_id,
            created_at=now,
            updated_at=now,
        )
        await item.insert()

        try:
            from app.services.rag_service import rag_service

            await rag_service.index_wiki_item(item)
        except Exception as exc:
            print(f"Wiki vector index error: {exc}")

        if record_event:
            await research_event_service.record_batch_events(
                events=[
                    {
                        "project_id": item.project_id,
                        "group_id": item.group_id,
                        "user_id": current_user_id,
                        "actor_type": actor_type,
                        "event_domain": "wiki",
                        "event_type": "wiki_item_created",
                        "stage_id": item.stage_id,
                        "payload": {
                            "wiki_item_id": str(item.id),
                            "item_type": item.item_type,
                            "source_type": item.source_type,
                            "source_id": item.source_id,
                            "visibility": item.visibility,
                            "confidence_level": item.confidence_level,
                        },
                    }
                ],
                current_user_id=current_user_id if actor_type != "system" else None,
            )

        return item

    @staticmethod
    async def list_items(
        project_id: str,
        *,
        group_id: Optional[str] = None,
        item_type: Optional[str] = None,
        item_types: Optional[List[str]] = None,
        stage_id: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> Tuple[List[WikiItem], int]:
        """List Wiki items for a project."""
        query = WikiService._build_query(project_id, group_id, item_type, item_types, stage_id)
        cursor = WikiItem.find(query).sort("-updated_at").skip(skip).limit(limit)
        items = await cursor.to_list()
        total = await WikiItem.find(query).count()
        return items, total

    @staticmethod
    async def update_item(
        item: WikiItem,
        data: Dict[str, Any],
        *,
        current_user_id: str,
        actor_type: str = "student",
    ) -> WikiItem:
        """Update a Wiki item and record a research event."""
        for key, value in data.items():
            if value is not None and hasattr(item, key):
                setattr(item, key, value)
        item.updated_by = current_user_id
        item.updated_at = datetime.utcnow()
        await item.save()

        try:
            from app.services.rag_service import rag_service

            await rag_service.index_wiki_item(item)
        except Exception as exc:
            print(f"Wiki vector reindex error: {exc}")

        await research_event_service.record_batch_events(
            events=[
                {
                    "project_id": item.project_id,
                    "group_id": item.group_id,
                    "user_id": current_user_id,
                    "actor_type": actor_type,
                    "event_domain": "wiki",
                    "event_type": "wiki_item_updated",
                    "stage_id": item.stage_id,
                    "payload": {
                        "wiki_item_id": str(item.id),
                        "item_type": item.item_type,
                        "updated_fields": sorted(data.keys()),
                    },
                }
            ],
            current_user_id=current_user_id if actor_type != "system" else None,
        )
        return item

    @staticmethod
    async def search_items(
        project_id: str,
        query: str,
        *,
        group_id: Optional[str] = None,
        item_type: Optional[str] = None,
        item_types: Optional[List[str]] = None,
        stage_id: Optional[str] = None,
        limit: int = 5,
    ) -> List[Dict[str, Any]]:
        """Search Wiki items using deterministic keyword scoring."""
        if limit <= 0:
            return []

        db_query = WikiService._build_query(project_id, group_id, item_type, item_types, stage_id)
        candidates = await WikiItem.find(db_query).sort("-updated_at").limit(100).to_list()
        scored = [
            (WikiService._score_item(item, query), item)
            for item in candidates
        ]
        ranked = [
            item for score, item in sorted(scored, key=lambda pair: pair[0], reverse=True)
            if score > 0
        ]
        if not ranked and candidates:
            ranked = candidates[: min(limit, 2)]

        return [
            {
                **WikiService._to_response_dict(item),
                "score": WikiService._score_item(item, query) or 0.1,
            }
            for item in ranked[:limit]
        ]


wiki_service = WikiService()
