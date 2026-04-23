"""AI conversation model."""

from datetime import datetime
from typing import Dict, Optional

from beanie import Document
from pydantic import Field


class AIConversation(Document):
    """AI conversation document model."""

    project_id: str = Field(..., index=True)
    user_id: str = Field(..., index=True)
    persona_id: Optional[str] = None
    title: str = Field(default="新对话")
    context_config: Dict = Field(
        default_factory=lambda: {
            "use_whiteboard": False,
            "use_docs": False,
            "use_project_context": False,
        }
    )
    category: str = Field(default="chat", index=True) # "chat" for tutor, "action" for specialized tools
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "ai_conversations"
        indexes = [
            [("project_id", 1)],
            [("user_id", 1)],
            [("created_at", 1)],
        ]

