"""RAG (Retrieval-Augmented Generation) service.

The deployable version keeps retrieval lightweight. Local embedding models are
disabled because they pull large ML/CUDA wheels during Docker build, which is
too costly for the teaching-experiment server.
"""

from typing import List, Optional

from app.repositories.chat_log import ChatLog
from app.repositories.document import Document
from app.services.research_event_service import research_event_service
from app.services.wiki_service import wiki_service


class RAGService:
    """Service for RAG retrieval and generation."""

    # Vector retrieval is intentionally disabled for the cloud trial build.
    VECTOR_WEIGHT = 0.0
    SLIDING_WINDOW_WEIGHT = 0.5
    REALTIME_WEIGHT = 0.5
    WIKI_MAX_RESULTS = 3

    @staticmethod
    async def process_resource(
        resource_id: str,
        content: str,
        chunk_size: int = 1000,
        overlap: int = 100,
    ):
        """Keep the vectorization hook without installing local ML dependencies."""
        return None

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
        record_event: bool = True,
    ) -> dict:
        """Retrieve context using Wiki-first lightweight retrieval."""
        if max_results <= 0:
            return {"content": "", "citations": []}

        wiki_limit = min(RAGService.WIKI_MAX_RESULTS, max_results)
        remaining_limit = max(0, max_results - wiki_limit)
        sliding_limit = max(1, int(remaining_limit * RAGService.SLIDING_WINDOW_WEIGHT)) if remaining_limit else 0
        realtime_limit = max(0, remaining_limit - sliding_limit)

        vector_results = await RAGService._vector_retrieve(project_id, query, 0)
        wiki_results = await RAGService._wiki_retrieve(
            project_id,
            query,
            wiki_limit,
            group_id=group_id,
            stage_id=stage_id,
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

        # Merge and deduplicate
        all_results = wiki_results + vector_results + sliding_results + realtime_results

        unique_results = []
        seen_ids = set()

        for res in all_results:
            # Create a unique key for deduplication
            key = f"{res['type']}:{res['id']}"
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
    ) -> None:
        """Record a lightweight retrieval event for later RAG trace analysis."""
        try:
            await research_event_service.record_batch_events(
                events=[
                    {
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
                        "event_domain": "rag",
                        "event_type": "retrieval_requested",
                        "stage_id": stage_id,
                        "payload": {
                            "query_length": len(query or ""),
                            "result_count": len(results),
                            "result_types": [result.get("type") for result in results],
                            "citation_ids": [result.get("id") for result in results],
                            "wiki_result_count": len([
                                result for result in results
                                if result.get("type") == "wiki"
                            ]),
                        },
                    }
                ],
                current_user_id=user_id,
            )
        except Exception as exc:
            print(f"RAG event record error: {exc}")

    @staticmethod
    async def _vector_retrieve(project_id: str, query: str, limit: int) -> List[dict]:
        """Vector retrieval placeholder for future remote embedding/vector DB support."""
        return []

    @staticmethod
    async def _wiki_retrieve(
        project_id: str,
        query: str,
        limit: int,
        *,
        group_id: Optional[str] = None,
        stage_id: Optional[str] = None,
    ) -> List[dict]:
        """Retrieve structured project Wiki items before unstructured context."""
        results = await wiki_service.search_items(
            project_id,
            query,
            group_id=group_id,
            stage_id=stage_id,
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
        # Find documents updated recently
        docs = await Document.find(
            Document.project_id == project_id
        ).sort("-updated_at").limit(limit).to_list()

        for doc in docs:
            # Simple keyword matching within preview text
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
