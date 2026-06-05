"""AI scaffold round memory for research-condition optimization."""

from datetime import datetime
from typing import Any, Dict, List, Optional

from beanie import Document
from pydantic import Field


class ScaffoldRoundMemory(Document):
    """A single student-visible AI scaffold and its follow-up evidence."""

    course_id: Optional[str] = Field(default=None, index=True)
    project_id: str = Field(..., index=True)
    group_id: str = Field(..., index=True)
    stage_id: Optional[str] = Field(default=None, index=True)
    condition_type: str = Field(default="experimental", pattern="^(experimental|control|unknown)$", index=True)
    experiment_version_id: Optional[str] = Field(default=None, index=True)
    optimization_version_id: Optional[str] = Field(default=None, index=True)

    trigger_type: str = Field(default="manual_mention", pattern="^[a-zA-Z0-9_]+$")
    trigger_reason: str = Field(default="")
    input_message_id: Optional[str] = Field(default=None, index=True)
    output_message_id: Optional[str] = Field(default=None, index=True)
    read_memory_ids: List[str] = Field(default_factory=list)

    routing_mode: str = Field(default="single", pattern="^(single|parallel|pipeline|debate|direct)$")
    selected_roles: List[str] = Field(default_factory=list)
    primary_role: Optional[str] = Field(default=None, index=True)
    retrieval_sources: List[Dict[str, Any]] = Field(default_factory=list)

    response_text: str = Field(default="")
    response_length: int = Field(default=0, ge=0)
    response_style: str = Field(default="student_scaffold", pattern="^(student_scaffold|direct_llm|fallback)$")
    student_visible: bool = Field(default=True)

    followup_window_start: datetime = Field(default_factory=datetime.utcnow, index=True)
    followup_window_end: Optional[datetime] = Field(default=None, index=True)
    followup_events: List[Dict[str, Any]] = Field(default_factory=list)
    student_response_type: str = Field(
        default="pending",
        pattern="^(pending|ignored|acknowledged|continued_discussion|uploaded_resource|edited_document|created_wiki|updated_inquiry_node|asked_teacher|submitted_task|misfired)$",
        index=True,
    )
    outcome_label: str = Field(default="pending", pattern="^[a-zA-Z0-9_]+$", index=True)

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)

    class Settings:
        """Beanie settings."""

        name = "scaffold_round_memories"
        indexes = [
            [("project_id", 1), ("group_id", 1), ("stage_id", 1), ("created_at", -1)],
            [("condition_type", 1), ("experiment_version_id", 1), ("created_at", -1)],
            [("project_id", 1), ("group_id", 1), ("outcome_label", 1), ("created_at", -1)],
        ]
