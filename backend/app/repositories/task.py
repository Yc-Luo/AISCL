"""Task model."""

from datetime import datetime
from typing import List, Optional

from beanie import Document
from pydantic import Field


class Task(Document):
    """Task document model."""

    project_id: str = Field(..., index=True)
    title: str = Field(..., min_length=1, max_length=200)
    column: str = Field(default="todo", pattern="^(todo|doing|done)$")
    priority: str = Field(default="medium", pattern="^(low|medium|high)$")
    assignees: List[str] = Field(default_factory=list)  # List of user IDs
    order: float = Field(default=0.0)  # For drag-and-drop sorting (Lexorank)
    description: Optional[str] = Field(default=None, max_length=10000)
    due_date: Optional[datetime] = None
    source_type: Optional[str] = Field(default=None, index=True)
    course_task_release_id: Optional[str] = Field(default=None, index=True)
    submission_status: Optional[str] = Field(
        default=None,
        pattern="^(submitted|late_submitted|auto_submitted)$",
        index=True,
    )
    submitted_at: Optional[datetime] = None
    submitted_by: Optional[str] = Field(default=None, index=True)
    submission_note: Optional[str] = Field(default=None, max_length=2000)
    artifact_document_id: Optional[str] = Field(default=None, index=True)
    artifact_document_ids: List[str] = Field(default_factory=list)
    artifact_snapshot_id: Optional[str] = Field(default=None, index=True)
    artifact_inquiry_snapshot_id: Optional[str] = Field(default=None, index=True)
    artifact_wiki_item_ids: List[str] = Field(default_factory=list)
    submission_artifact_ids: List[str] = Field(default_factory=list)
    review_status: Optional[str] = Field(
        default=None,
        pattern="^(pending|reviewed|revision_requested)$",
        index=True,
    )
    review_comment: Optional[str] = Field(default=None, max_length=4000)
    reviewed_by: Optional[str] = Field(default=None, index=True)
    reviewed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "tasks"
        indexes = [
            [("project_id", 1)],
            [("project_id", 1), ("column", 1)],
            [("course_task_release_id", 1)],
            [("source_type", 1), ("due_date", 1), ("submission_status", 1)],
        ]
