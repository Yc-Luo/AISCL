"""Group-level rolling memory summary for AI continuity."""

from datetime import datetime
from typing import Any, Dict, List, Optional

from beanie import Document
from pydantic import Field


class GroupMemorySummary(Document):
    """Internal memory summary for one group and one learning stage."""

    project_id: str = Field(..., index=True)
    group_id: Optional[str] = Field(default=None, index=True)
    stage_id: Optional[str] = Field(default=None, index=True)
    memory_type: str = Field(
        default="stage_rolling_summary",
        pattern="^(stage_rolling_summary|group_state_memory)$",
        index=True,
    )
    content: Dict[str, Any] = Field(default_factory=dict)
    source_chat_log_ids: List[str] = Field(default_factory=list)
    source_research_event_ids: List[str] = Field(default_factory=list)
    source_counts: Dict[str, int] = Field(default_factory=dict)
    source_range: Dict[str, Optional[datetime]] = Field(default_factory=dict)
    last_processed_chat_log_id: Optional[str] = None
    last_processed_research_event_id: Optional[str] = None
    last_processed_chat_time: Optional[datetime] = Field(default=None, index=True)
    last_processed_event_time: Optional[datetime] = Field(default=None, index=True)
    version: int = Field(default=1, ge=1)
    update_trigger: str = Field(
        default="event_threshold",
        pattern="^(initial|event_threshold|ai_interaction_threshold|artifact_threshold|stage_transition|on_ai_request|manual_regenerate)$",
    )
    visible_to_student: bool = Field(default=False)
    deleted_at: Optional[datetime] = Field(default=None, index=True)
    created_by: str = Field(default="system")
    updated_by: str = Field(default="system")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "group_memory_summaries"
        indexes = [
            [("project_id", 1), ("group_id", 1), ("stage_id", 1), ("memory_type", 1)],
            [("project_id", 1), ("stage_id", 1), ("updated_at", -1)],
            [("project_id", 1), ("group_id", 1), ("updated_at", -1)],
        ]
