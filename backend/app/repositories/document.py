"""Document model for collaborative document editing."""

from datetime import datetime
from typing import Optional

from beanie import Document as BeanieDocument
from pydantic import Field
from pymongo import IndexModel


class Document(BeanieDocument):
    """Document document model."""

    project_id: str = Field(..., index=True)
    title: str = Field(..., min_length=1, max_length=200)
    content: Optional[str] = Field(None)  # HTML content
    content_state: bytes = Field(default=b"")  # Y.js ProseMirror state (binary)
    preview_text: Optional[str] = Field(None, max_length=200)  # First 50 chars for preview
    last_modified_by: str = Field(..., index=True)
    is_archived: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "documents"
        indexes = [
            [("project_id", 1)],
            [("title", 1)],
            # [("project_id", 1), ("title", 1)],
        ]


class DocumentVersion(BeanieDocument):
    """Document version snapshot for history."""

    document_id: str = Field(..., index=True)
    content_state: bytes  # Y.js ProseMirror state snapshot
    version_number: int = Field(..., index=True)
    created_by: str = Field(..., index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "document_versions"
        indexes = [
            [("document_id", 1)],
            [("document_id", 1), ("version_number", 1)],
            IndexModel([("created_at", 1)], expireAfterSeconds=2592000),
        ]

