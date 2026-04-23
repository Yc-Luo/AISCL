"""Activity log model."""

from datetime import datetime
from typing import Optional

from beanie import Document
from pydantic import Field


class ActivityLog(Document):
    """Activity log document model."""

    project_id: str = Field(..., index=True)
    user_id: str = Field(..., index=True)
    module: str = Field(..., pattern="^(whiteboard|document|chat|resource|resources|task|calendar|browser|ai|dashboard|analytics|inquiry)$")
    action: str  # edit, view, upload, comment, etc.
    target_id: Optional[str] = None
    duration: int = Field(default=0, ge=0)  # Duration in seconds
    metadata: Optional[dict] = None  # Extra context (label, value, etc.)
    timestamp: datetime = Field(default_factory=datetime.utcnow, index=True)

    class Settings:
        """Beanie settings."""

        name = "activity_logs"

        indexes = [
            [("project_id", 1)],
            [("user_id", 1)],
            [("timestamp", 1)],
            [("project_id", 1), ("user_id", 1), ("timestamp", 1)],
            [("module", 1), ("timestamp", 1)],  # For analytics queries
            [("project_id", 1), ("module", 1), ("timestamp", 1)],  # For project analytics
        ]

        # TTL index: automatically delete documents after 365 days
        # Note: TTL indexes in MongoDB automatically remove documents based on a timestamp field
        # This will be created via database migration or manual MongoDB command

