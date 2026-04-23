"""Chat log model."""

from datetime import datetime

from beanie import Document
from pydantic import Field


class ChatLog(Document):
    """Chat log document model."""

    project_id: str = Field(..., index=True)
    user_id: str = Field(..., index=True)
    content: str
    message_type: str = Field(default="text", pattern="^(text|system|ai)$")
    mentions: list[str] = Field(default_factory=list)  # List of mentioned user IDs
    metadata: dict | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "chat_logs"
        indexes = [
            [("project_id", 1)],
            [("user_id", 1)],
            [("created_at", 1)],
            [("project_id", 1), ("created_at", 1)],
        ]
