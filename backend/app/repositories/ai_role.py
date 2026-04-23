"""AI role model for managing different AI personas."""

from datetime import datetime

from typing import Optional
from datetime import datetime

from beanie import Document as BeanieDocument
from pydantic import Field


class AIRole(BeanieDocument):
    """AI role/persona model."""

    name: str = Field(..., min_length=1, max_length=100)
    icon: Optional[str] = None  # Icon URL or emoji
    system_prompt: str = Field(..., min_length=1, max_length=5000)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    is_default: bool = Field(default=False)
    description: Optional[str] = Field(None, max_length=500)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "ai_roles"
        indexes = [
            [("name", 1)],
            [("is_default", 1)],
        ]

