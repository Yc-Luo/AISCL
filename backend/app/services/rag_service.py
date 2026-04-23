"""RAG (Retrieval-Augmented Generation) service."""

from typing import List, Optional

from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import settings



from langchain_community.embeddings import HuggingFaceEmbeddings
from app.core.config import settings

from app.repositories.resource_embedding import ResourceEmbedding
from app.repositories.chat_log import ChatLog
from app.repositories.document import Document
from app.repositories.resource import Resource

class RAGService:
    """Service for RAG retrieval and generation."""

    # Retrieval strategy weights
    VECTOR_WEIGHT = 0.4
    SLIDING_WINDOW_WEIGHT = 0.3
    REALTIME_WEIGHT = 0.3
    
    _embedding_model = None

    @classmethod
    def get_embedding_model(cls):
        """Lazy load the embedding model."""
        if cls._embedding_model is None:
            import os
            os.environ.setdefault("HF_HOME", "/app/data/hf_cache")
            os.environ.setdefault("TRANSFORMERS_CACHE", os.environ["HF_HOME"])
            os.environ.setdefault("SENTENCE_TRANSFORMERS_HOME", os.environ["HF_HOME"])
            os.environ.setdefault("XDG_CACHE_HOME", "/app/data/xdg_cache")
            
            # Use a lightweight, high-performance open source model
            cls._embedding_model = HuggingFaceEmbeddings(
                model_name="sentence-transformers/all-MiniLM-L6-v2"
            )
        return cls._embedding_model

    @staticmethod
    async def generate_embedding(text: str) -> List[float]:
        """Generate embedding for text using HuggingFace."""
        model = RAGService.get_embedding_model()
        # Use async embedding generation
        return await model.aembed_query(text)

    @staticmethod
    async def process_resource(resource_id: str, content: str, chunk_size: int = 1000, overlap: int = 100):
        """Process a resource text into chunks and save embeddings."""
        chunks = []
        for i in range(0, len(content), chunk_size - overlap):
            chunk = content[i : i + chunk_size]
            if len(chunk) < 50:  # Skip very small final chunks
                continue
            chunks.append(chunk)

        # Generate embeddings batch
        # Note: HuggingFaceEmbeddings.embed_documents is synchronous by default but fast enough for local.
        # For true async batching we could use run_in_executor, or just loop for now.
        
        embeddings_docs = []
        for index, chunk in enumerate(chunks):
            vector = await RAGService.generate_embedding(chunk)
            doc = ResourceEmbedding(
                resource_id=resource_id,
                chunk_index=index,
                content=chunk,
                vector=vector
            )
            embeddings_docs.append(doc)
            
        if embeddings_docs:
            await ResourceEmbedding.insert_many(embeddings_docs)
            
    @staticmethod
    async def retrieve_context(
        project_id: str,
        query: str,
        max_results: int = 5,
    ) -> dict:
        """Retrieve context using hybrid retrieval strategy."""
        
        # Calculate limits for each strategy
        vector_limit = max(1, int(max_results * RAGService.VECTOR_WEIGHT))
        sliding_limit = max(1, int(max_results * RAGService.SLIDING_WINDOW_WEIGHT))
        realtime_limit = max(1, int(max_results * RAGService.REALTIME_WEIGHT))

        # Run strategies concurrently (simulated with await sequential)
        # 1. Vector Search
        vector_results = await RAGService._vector_retrieve(project_id, query, vector_limit)
        
        # 2. Sliding Window (Recent Documents)
        sliding_results = await RAGService._sliding_window_retrieve(project_id, query, sliding_limit)
        
        # 3. Realtime (Chat Logs)
        realtime_results = await RAGService._realtime_retrieve(project_id, query, realtime_limit)
        
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
                    "score": r.get("score", 0)
                }
                for r in final_results
            ],
        }

    @staticmethod
    async def _vector_retrieve(project_id: str, query: str, limit: int) -> List[dict]:
        """Vector retrieval using generated embeddings."""
        try:
            query_vector = await RAGService.generate_embedding(query)
            
            # Note: This is a simplistic in-memory vector search for demonstration.
            # In production, use MongoDB Atlas Vector Search ($vectorSearch stage).
            # We first filter candidates by project indirectly (via resources)
            
            # Step 1: Get resource IDs for this project
            resources = await Resource.find(Resource.project_id == project_id).to_list()
            resource_ids = [str(r.id) for r in resources]
            
            if not resource_ids:
                return []
                
            # Step 2: Since we can't easily do cosine sim in standard Mongo query without Atlas Search index,
            # we might need to rely on a different approach or fetch candidates.
            # HERE WE ARE MOCKING THE ATLAS SEARCH BEHAVIOR for now.
            # Real implementation would look like:
            # pipeline = [
            #     {
            #       '$vectorSearch': {
            #         'index': 'vector_index',
            #         'path': 'vector',
            #         'queryVector': query_vector,
            #         'numCandidates': 100,
            #         'limit': limit,
            #         'filter': { 'resource_id': { '$in': resource_ids } }
            #       }
            #     }
            # ]
            # results = await ResourceEmbedding.aggregate(pipeline).to_list()

            # Fallback: Text Search if Vector Search not available
            # We return empty for now to push for Atlas configuration
            return []
            
        except Exception as e:
            print(f"Vector retrieval error: {e}")
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
                    "score": 0.85 # High score for keyword match in docs
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
                    "score": 0.75 # Good score for chat match
                })
                if len(results) >= limit:
                    break
        return results

rag_service = RAGService()
