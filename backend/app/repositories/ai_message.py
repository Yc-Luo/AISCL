"""AI message model."""

from datetime import datetime
from typing import List, Optional

from beanie import Document
from pydantic import Field


class Citation(Document):
    """Citation schema."""

    resource_id: str
    page: Optional[int] = None


class AIMessage(Document):
    """AI message document model."""

    conversation_id: str = Field(..., index=True)
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str
    citations: List[dict] = Field(default_factory=list)  # List of Citation-like dicts
    metadata: Optional[dict] = None
    feedback: Optional[dict] = None  # {rating: int, comment: str}
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "ai_messages"
        indexes = [
            [("conversation_id", 1)],
            [("created_at", 1)],
            [("conversation_id", 1), ("created_at", 1)],
        ]
