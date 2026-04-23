from datetime import datetime
from typing import Dict, Any, Optional
from beanie import Document, Indexed
from pydantic import Field

class CollaborationSnapshot(Document):
    """
    Model for storing collaborative tool snapshots (Yjs update blobs).
    Reuses the structure from the former whiteboard snapshot.
    """
    project_id: Indexed(str)
    snapshot_data: Dict[str, Any]
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "collaboration_snapshots" # Changed collection name to be generic
        use_revision = True

    @classmethod
    async def get_latest(cls, project_id: str) -> Optional["CollaborationSnapshot"]:
        return await cls.find_one(
            cls.project_id == project_id,
            sort=[("updated_at", -1)]
        )
