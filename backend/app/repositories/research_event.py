"""Research-mode event document model."""

from datetime import datetime
from typing import Any, Dict, Optional

from beanie import Document
from pydantic import Field


class ResearchEvent(Document):
    """Structured research event for experiment-mode logging."""

    project_id: str = Field(..., index=True)
    experiment_version_id: Optional[str] = Field(default=None, index=True)
    room_id: Optional[str] = None
    group_id: Optional[str] = Field(default=None, index=True)
    user_id: Optional[str] = Field(default=None, index=True)
    actor_type: str = Field(
        ...,
        pattern="^(student|teacher|ai_assistant|ai_tutor|system)$",
    )
    event_domain: str = Field(
        ...,
        pattern="^(dialogue|scaffold|inquiry_structure|shared_record|stage_transition|wiki|rag)$",
    )
    event_type: str = Field(..., pattern="^[a-zA-Z0-9_]+$")
    event_time: datetime = Field(default_factory=datetime.utcnow, index=True)
    stage_id: Optional[str] = Field(default=None, index=True)
    sequence_index: Optional[int] = Field(default=None, ge=0)
    payload: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "research_events"
        indexes = [
            [("project_id", 1), ("event_time", 1)],
            [("project_id", 1), ("group_id", 1), ("stage_id", 1), ("event_time", 1)],
            [("experiment_version_id", 1), ("event_domain", 1), ("event_time", 1)],
            [("project_id", 1), ("event_domain", 1), ("event_time", 1)],
        ]
