"""Resource embedding model for RAG."""

from datetime import datetime
from typing import List, Optional

from beanie import Document, Link
from pydantic import Field
from pymongo import IndexModel, ASCENDING

from app.repositories.resource import Resource


class ResourceEmbedding(Document):
    """Resource embedding document model."""

    resource_id: str = Field(..., index=True)
    chunk_index: int = Field(..., ge=0)
    content: str
    vector: List[float]
    metadata: Optional[dict] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "resource_embeddings"
        indexes = [
            IndexModel([("resource_id", ASCENDING)], name="resource_id_index"),
            IndexModel([("resource_id", ASCENDING), ("chunk_index", ASCENDING)], name="resource_chunk_index"),
        ]
        
        # Note: Vector search index is typically created manually in MongoDB Atlas
        # or via a specific command, as standard indexes don't support vector search yet.
