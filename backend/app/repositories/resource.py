"""Resource model."""

from datetime import datetime
from typing import Optional

from beanie import Document
from pydantic import Field


class Resource(Document):
    """Resource document model."""

    project_id: str = Field(..., index=True)
    filename: str
    file_key: str  # S3 Object Key: projects/{project_id}/files/{file_id}
    url: str  # CDN URL
    size: int = Field(..., ge=0)  # File size in bytes
    mime_type: str
    uploaded_by: str = Field(..., index=True)
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "resources"
        indexes = [
            [("project_id", 1)],
            [("uploaded_by", 1)],
            [("uploaded_at", 1)],
        ]

