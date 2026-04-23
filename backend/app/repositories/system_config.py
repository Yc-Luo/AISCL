"""System configuration model."""

from datetime import datetime
from typing import Optional

from beanie import Document as BeanieDocument
from pydantic import Field


class SystemConfig(BeanieDocument):
    """System configuration model."""

    key: str = Field(..., unique=True, index=True)
    value: str
    description: Optional[str] = None
    updated_by: str = Field(..., index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "system_configs"
        indexes = [
            [("key", 1)],
        ]

