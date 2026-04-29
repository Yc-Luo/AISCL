"""Resource model."""

from datetime import datetime
from typing import Optional

from beanie import Document
from pydantic import Field


class Resource(Document):
    """Resource document model."""

    project_id: Optional[str] = Field(default=None, index=True)
    course_id: Optional[str] = Field(default=None, index=True)
    scope: str = Field(default="project", pattern="^(project|course)$", index=True)
    filename: str
    file_key: str  # S3 Object Key: projects/{project_id}/files/{file_id} or courses/{course_id}/files/{file_id}
    url: str  # CDN URL
    size: int = Field(..., ge=0)  # File size in bytes
    mime_type: str
    source_type: str = Field(default="library", index=True)
    uploaded_by: str = Field(..., index=True)
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "resources"
        indexes = [
            [("project_id", 1)],
            [("course_id", 1)],
            [("scope", 1)],
            [("project_id", 1), ("source_type", 1)],
            [("course_id", 1), ("source_type", 1)],
            [("uploaded_by", 1)],
            [("uploaded_at", 1)],
        ]
