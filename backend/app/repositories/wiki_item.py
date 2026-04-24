"""Project Wiki item model for lightweight RAG grounding."""

from datetime import datetime
from typing import List, Optional

from beanie import Document
from pydantic import Field


class WikiItem(Document):
    """Structured project knowledge item used by LLM Wiki and RAG."""

    project_id: str = Field(..., index=True)
    group_id: Optional[str] = Field(default=None, index=True)
    stage_id: Optional[str] = Field(default=None, index=True)
    item_type: str = Field(
        default="note",
        pattern="^(task_brief|concept|evidence|claim|controversy|stage_summary|note)$",
        index=True,
    )
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1)
    summary: Optional[str] = Field(default=None, max_length=500)
    source_type: str = Field(
        default="manual",
        pattern="^(teacher_brief|document|chat|inquiry|ai|manual|system)$",
    )
    source_id: Optional[str] = None
    source_event_ids: List[str] = Field(default_factory=list)
    linked_item_ids: List[str] = Field(default_factory=list)
    created_by: str = Field(..., index=True)
    updated_by: Optional[str] = None
    visibility: str = Field(default="project", pattern="^(project|group)$")
    confidence_level: str = Field(
        default="unverified",
        pattern="^(unverified|working|verified)$",
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "wiki_items"
        indexes = [
            [("project_id", 1)],
            [("project_id", 1), ("item_type", 1), ("updated_at", -1)],
            [("project_id", 1), ("group_id", 1), ("updated_at", -1)],
            [("source_type", 1), ("source_id", 1)],
        ]
