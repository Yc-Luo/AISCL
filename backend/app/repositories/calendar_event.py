"""Calendar event model."""

from datetime import datetime
from typing import Optional

from beanie import Document
from pydantic import Field


class CalendarEvent(Document):
    """Calendar event document model."""

    project_id: str = Field(..., index=True)
    title: str = Field(..., min_length=1, max_length=200)
    start_time: datetime = Field(..., index=True)
    end_time: datetime
    type: str = Field(default="meeting", pattern="^(meeting|deadline|personal)$")
    created_by: str = Field(..., index=True)
    is_private: bool = Field(default=False)  # Teacher can view private events
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "calendar_events"
        indexes = [
            [("project_id", 1)],
            [("project_id", 1), ("start_time", 1)],
            [("created_by", 1)],
        ]

