"""Document comment model for annotations."""

from datetime import datetime
from typing import List, Optional

from beanie import Document as BeanieDocument
from pydantic import Field


class CommentMessage(BeanieDocument):
    """Comment message within a comment thread."""

    user_id: str
    content: str = Field(..., min_length=1, max_length=1000)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class DocComment(BeanieDocument):
    """Document comment/annotation model."""

    document_id: str = Field(..., index=True)
    anchor_context: dict = Field(default_factory=dict)  # ProseMirror selection context
    status: str = Field(default="open", pattern="^(open|resolved)$")
    mentioned_user_ids: List[str] = Field(default_factory=list)  # Users mentioned in comment
    messages: List[dict] = Field(default_factory=list)  # List of CommentMessage-like dicts
    created_by: str = Field(..., index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "doc_comments"
        indexes = [
            [("document_id", 1)],
            [("document_id", 1), ("status", 1)],
            [("created_by", 1)],
        ]

