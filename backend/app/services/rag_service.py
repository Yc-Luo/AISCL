"""RAG (Retrieval-Augmented Generation) service.

The deployable version keeps retrieval lightweight. Local embedding models are
disabled because they pull large ML/CUDA wheels during Docker build, which is
too costly for the teaching-experiment server.
"""

import re
from typing import Any, Dict, List, Optional

from app.core.config import settings
from app.repositories.chat_log import ChatLog
from app.repositories.document import Document
from app.repositories.resource import Resource
from app.services.embedding_service import embedding_service
from app.services.research_event_service import research_event_service
from app.services.vector_store_service import vector_store_service
from app.services.wiki_service import wiki_service


class RAGService:
    """Service for RAG retrieval and generation."""

    VECTOR_WEIGHT = 0.45
    SLIDING_WINDOW_WEIGHT = 0.5
    REALTIME_WEIGHT = 0.5
    WIKI_MAX_RESULTS = 3
    VECTOR_MAX_RESULTS = 4

    @staticmethod
    async def process_resource(
        resource_id: str,
        content: str,
        chunk_size: Optional[int] = None,
        overlap: Optional[int] = None,
    ):
        """Index an uploaded resource into the external vector store."""
        resource = await Resource.get(resource_id)
        if not resource:
            return False

        return await RAGService.index_text(
            project_id=resource.project_id,
            source_type="resource",
            source_id=str(resource.id),
            title=resource.filename,
            content=content,
            metadata={
                "resource_id": str(resource.id),
                "filename": resource.filename,
                "mime_type": resource.mime_type,
                "uploaded_by": resource.uploaded_by,
            },
            chunk_size=chunk_size,
            overlap=overlap,
        )

    @staticmethod
    async def index_wiki_item(wiki_item: Any) -> bool:
        """Index one Wiki item for semantic retrieval."""
        return await RAGService.index_text(
            project_id=wiki_item.project_id,
            group_id=wiki_item.group_id,
            stage_id=wiki_item.stage_id,
            source_type="wiki",
            source_id=str(wiki_item.id),
            title=wiki_item.title,
            content=f"{wiki_item.title}\n\n{wiki_item.summary or ''}\n\n{wiki_item.content}",
            metadata={
                "wiki_item_id": str(wiki_item.id),
                "item_type": wiki_item.item_type,
                "source_type_detail": wiki_item.source_type,
                "visibility": wiki_item.visibility,
                "confidence_level": wiki_item.confidence_level,
            },
        )

    @staticmethod
    async def index_text(
        *,
        project_id: str,
        source_type: str,
        source_id: str,
        title: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        group_id: Optional[str] = None,
        stage_id: Optional[str] = None,
        chunk_size: Optional[int] = None,
        overlap: Optional[int] = None,
    ) -> bool:
        """Chunk, embed, and index text into Qdrant."""
        chunks = RAGService._chunk_text(
            content,
            chunk_size=chunk_size or settings.RAG_CHUNK_SIZE,
            overlap=overlap if overlap is not None else settings.RAG_CHUNK_OVERLAP,
        )
        if not chunks:
            return False

        vectors = await embedding_service.embed_texts(chunks)
        if not vectors:
            return False

        points = []
        for chunk_index, (chunk, vector) in enumerate(zip(chunks, vectors)):
            points.append({
                "id": vector_store_service.point_id(source_type, source_id, chunk_index),
                "vector": vector,
                "payload": {
                    "project_id": project_id,
                    "group_id": group_id,
                    "stage_id": stage_id,
                    "source_type": source_type,
                    "source_id": source_id,
                    "title": title,
                    "content": chunk,
                    "chunk_index": chunk_index,
                    "visibility": "project" if not group_id else "group",
                    **(metadata or {}),
                },
            })

        return await vector_store_service.upsert_points(points)

    @staticmethod
    def _chunk_text(text: str, *, chunk_size: int, overlap: int) -> List[str]:
        """Split text into overlapping chunks."""
        cleaned = re.sub(r"\s+", " ", (text or "").strip())
        if not cleaned:
            return []
        if len(cleaned) <= chunk_size:
            return [cleaned]

        chunks = []
        start = 0
        safe_overlap = max(0, min(overlap, chunk_size // 2))
        while start < len(cleaned):
            end = min(len(cleaned), start + chunk_size)
            chunks.append(cleaned[start:end])
            if end >= len(cleaned):
                break
            start = max(end - safe_overlap, start + 1)
        return chunks

    @staticmethod
    async def retrieve_context(
        project_id: str,
        query: str,
        max_results: int = 5,
        *,
        group_id: Optional[str] = None,
        stage_id: Optional[str] = None,
        user_id: Optional[str] = None,
        actor_type: str = "system",
        room_id: Optional[str] = None,
        experiment_version_id: Optional[str] = None,
        source_types: Optional[List[str]] = None,
        wiki_item_types: Optional[List[str]] = None,
        record_event: bool = True,
    ) -> dict:
        """Retrieve context using Wiki-first lightweight retrieval."""
        if max_results <= 0:
            return {"content": "", "citations": []}

        wiki_limit = min(RAGService.WIKI_MAX_RESULTS, max_results)
        remaining_limit = max(0, max_results - wiki_limit)
        sliding_limit = max(1, int(remaining_limit * RAGService.SLIDING_WINDOW_WEIGHT)) if remaining_limit else 0
        realtime_limit = max(0, remaining_limit - sliding_limit)

        vector_results = await RAGService._vector_retrieve(
            project_id,
            query,
            min(RAGService.VECTOR_MAX_RESULTS, max_results),
            group_id=group_id,
            stage_id=stage_id,
            source_types=source_types,
            wiki_item_types=wiki_item_types,
        )
        wiki_results = await RAGService._wiki_retrieve(
            project_id,
            query,
            wiki_limit,
            group_id=group_id,
            stage_id=stage_id,
            item_types=wiki_item_types,
        )
        sliding_results = await RAGService._sliding_window_retrieve(
            project_id,
            query,
            sliding_limit,
        )
        realtime_results = await RAGService._realtime_retrieve(
            project_id,
            query,
            realtime_limit,
        )

        all_results = vector_results + wiki_results + sliding_results + realtime_results

        unique_results = []
        seen_ids = set()

        for res in all_results:
            key = f"{res['type']}:{res['id']}:{res.get('chunk_index', '')}"
            if key not in seen_ids:
                unique_results.append(res)
                seen_ids.add(key)

        final_results = unique_results[:max_results]

        if record_event:
            await RAGService._record_retrieval_event(
                project_id=project_id,
                query=query,
                results=final_results,
                group_id=group_id,
                stage_id=stage_id,
                user_id=user_id,
                actor_type=actor_type,
                room_id=room_id,
                experiment_version_id=experiment_version_id,
                source_types=source_types,
                wiki_item_types=wiki_item_types,
            )

        return {
            "content": "\n\n".join([RAGService._format_context_block(r) for r in final_results]),
            "citations": [
                {
                    "resource_id": r["id"],
                    "resource_type": r["type"],
                    "score": r.get("score", 0),
                    "title": r.get("title"),
                    "source_type": r.get("source_type"),
                }
                for r in final_results
            ],
        }

    @staticmethod
    def _format_context_block(result: dict) -> str:
        """Format one retrieval result for the model context."""
        if result.get("type") == "wiki":
            title = result.get("title") or "Wiki 条目"
            item_type = result.get("item_type") or "note"
            return f"[WIKI:{item_type}:{title}]: {result['content']}"
        return f"[{result['type'].upper()}]: {result['content']}"

    @staticmethod
    async def _record_retrieval_event(
        *,
        project_id: str,
        query: str,
        results: List[dict],
        group_id: Optional[str],
        stage_id: Optional[str],
        user_id: Optional[str],
        actor_type: str,
        room_id: Optional[str],
        experiment_version_id: Optional[str],
        source_types: Optional[List[str]],
        wiki_item_types: Optional[List[str]],
    ) -> None:
        """Record a lightweight retrieval event for later RAG trace analysis."""
        try:
            base_event = {
                "project_id": project_id,
                "experiment_version_id": experiment_version_id,
                "room_id": room_id,
                "group_id": group_id,
                "user_id": user_id,
                "actor_type": actor_type if actor_type in {
                    "student",
                    "teacher",
                    "ai_assistant",
                    "ai_tutor",
                    "system",
                } else "system",
                "stage_id": stage_id,
            }
            await research_event_service.record_batch_events(
                events=[
                    {
                        **base_event,
                        "event_domain": "rag",
                        "event_type": "retrieval_requested",
                        "payload": {
                            "query_length": len(query or ""),
                            "result_count": len(results),
                            "result_types": [result.get("type") for result in results],
                            "citation_ids": [result.get("id") for result in results],
                            "citation_titles": [result.get("title") for result in results],
                            "wiki_result_count": len([
                                result for result in results
                                if result.get("type") == "wiki"
                            ]),
                            "resource_result_count": len([
                                result for result in results
                                if result.get("type") == "resource"
                            ]),
                            "source_types_filter": source_types or [],
                            "wiki_item_types_filter": wiki_item_types or [],
                        },
                    }
                ] + ([
                    {
                        **base_event,
                        "event_domain": "rag",
                        "event_type": "citation_attached",
                        "payload": {
                            "citation_count": len(results),
                            "citation_ids": [result.get("id") for result in results],
                            "citation_titles": [result.get("title") for result in results],
                            "citation_types": [result.get("type") for result in results],
                        },
                    }
                ] if results else []),
                current_user_id=user_id,
            )
        except Exception as exc:
            print(f"RAG event record error: {exc}")

    @staticmethod
    async def _vector_retrieve(
        project_id: str,
        query: str,
        limit: int,
        *,
        group_id: Optional[str] = None,
        stage_id: Optional[str] = None,
        source_types: Optional[List[str]] = None,
        wiki_item_types: Optional[List[str]] = None,
    ) -> List[dict]:
        """Retrieve semantic matches from Qdrant."""
        if limit <= 0:
            return []

        query_vector = await embedding_service.embed_text(query)
        if not query_vector:
            return []

        matches = await vector_store_service.search(
            query_vector,
            project_id=project_id,
            group_id=group_id,
            stage_id=stage_id,
            source_types=source_types,
            item_types=wiki_item_types,
            limit=limit,
        )

        results = []
        for match in matches:
            payload = match.get("payload") or {}
            source_type = payload.get("source_type") or "vector"
            results.append({
                "id": payload.get("source_id") or str(match.get("id")),
                "type": source_type,
                "title": payload.get("title"),
                "item_type": payload.get("item_type"),
                "source_type": payload.get("source_type_detail") or source_type,
                "content": payload.get("content") or "",
                "score": match.get("score", 0),
                "chunk_index": payload.get("chunk_index"),
                "citation_source": "qdrant",
            })
        return results

    @staticmethod
    async def _wiki_retrieve(
        project_id: str,
        query: str,
        limit: int,
        *,
        group_id: Optional[str] = None,
        stage_id: Optional[str] = None,
        item_types: Optional[List[str]] = None,
    ) -> List[dict]:
        """Retrieve structured project Wiki items before unstructured context."""
        results = await wiki_service.search_items(
            project_id,
            query,
            group_id=group_id,
            stage_id=stage_id,
            item_types=item_types,
            limit=limit,
        )
        return [
            {
                "id": item["id"],
                "type": "wiki",
                "item_type": item.get("item_type"),
                "title": item.get("title"),
                "source_type": item.get("source_type"),
                "content": (item.get("summary") or item.get("content") or "")[:800],
                "score": item.get("score", 0.9),
            }
            for item in results
        ]

    @staticmethod
    async def _sliding_window_retrieve(project_id: str, query: str, limit: int) -> List[dict]:
        """Retrieve recent document content."""
        if limit <= 0:
            return []
        results = []
        docs = await Document.find(
            Document.project_id == project_id
        ).sort("-updated_at").limit(limit).to_list()

        for doc in docs:
            if doc.preview_text and query.lower() in doc.preview_text.lower():
                results.append({
                    "id": str(doc.id),
                    "type": "document",
                    "content": doc.preview_text[:500],
                    "score": 0.85,
                })
        return results

    @staticmethod
    async def _realtime_retrieve(project_id: str, query: str, limit: int) -> List[dict]:
        """Retrieve recent chat context."""
        if limit <= 0:
            return []
        results = []
        chats = await ChatLog.find(
            ChatLog.project_id == project_id
        ).sort("-created_at").limit(limit * 2).to_list()

        for chat in chats:
            if query.lower() in chat.content.lower():
                results.append({
                    "id": str(chat.id),
                    "type": "chat",
                    "content": f"{chat.user_id}: {chat.content}",
                    "score": 0.75,
                })
                if len(results) >= limit:
                    break
        return results


rag_service = RAGService()
