"""RAG (Retrieval-Augmented Generation) service.

The deployable version keeps retrieval lightweight. Local embedding models were
removed because sentence-transformers pulls torch and CUDA wheels during Docker
build, which is too costly for the teaching-experiment server.
"""

from typing import List

from app.repositories.chat_log import ChatLog
from app.repositories.document import Document


class RAGService:
    """Service for RAG retrieval and generation."""

    # Vector retrieval is intentionally disabled for the cloud trial build.
    VECTOR_WEIGHT = 0.0
    SLIDING_WINDOW_WEIGHT = 0.5
    REALTIME_WEIGHT = 0.5

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
    ) -> dict:
        """Retrieve context using hybrid retrieval strategy."""
        if max_results <= 0:
            return {"content": "", "citations": []}

        sliding_limit = max(1, int(max_results * RAGService.SLIDING_WINDOW_WEIGHT))
        realtime_limit = max(1, max_results - sliding_limit)

        vector_results = await RAGService._vector_retrieve(project_id, query, 0)
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
        all_results = vector_results + sliding_results + realtime_results

        unique_results = []
        seen_ids = set()

        for res in all_results:
            # Create a unique key for deduplication
            key = f"{res['type']}:{res['id']}"
            if key not in seen_ids:
                unique_results.append(res)
                seen_ids.add(key)

        final_results = unique_results[:max_results]

        return {
            "content": "\n\n".join([f"[{r['type'].upper()}]: {r['content']}" for r in final_results]),
            "citations": [
                {
                    "resource_id": r["id"],
                    "resource_type": r["type"],
                    "score": r.get("score", 0),
                }
                for r in final_results
            ],
        }

    @staticmethod
    async def _vector_retrieve(project_id: str, query: str, limit: int) -> List[dict]:
        """Vector retrieval placeholder for future remote embedding/vector DB support."""
        return []

    @staticmethod
    async def _sliding_window_retrieve(project_id: str, query: str, limit: int) -> List[dict]:
        """Retrieve recent document content."""
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
