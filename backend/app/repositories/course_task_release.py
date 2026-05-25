"""Course-level group task release model."""

from datetime import datetime
from typing import List, Optional

from beanie import Document
from pydantic import Field


class CourseTaskRelease(Document):
    """Teacher-published task release for all groups in a course."""

    course_id: str = Field(..., index=True)
    teacher_id: str = Field(..., index=True)
    title: str = Field(..., min_length=1, max_length=200)
    task_brief_html: Optional[str] = Field(default=None, max_length=3_000_000)
    task_background: Optional[str] = Field(default=None, max_length=3000)
    core_question: Optional[str] = Field(default=None, max_length=3000)
    collaboration_requirements: Optional[str] = Field(default=None, max_length=3000)
    deliverable_requirements: Optional[str] = Field(default=None, max_length=3000)
    evaluation_points: Optional[str] = Field(default=None, max_length=3000)
    due_at: Optional[datetime] = Field(default=None, index=True)
    allow_late_submission: bool = Field(default=True)
    status: str = Field(default="open", pattern="^(open|closed)$", index=True)
    target_project_ids: List[str] = Field(default_factory=list)
    synced_task_ids: List[str] = Field(default_factory=list)
    synced_document_ids: List[str] = Field(default_factory=list)
    created_by: str = Field(..., index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    published_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    closed_at: Optional[datetime] = None

    class Settings:
        """Beanie settings."""

        name = "course_task_releases"
        indexes = [
            [("course_id", 1), ("created_at", -1)],
            [("teacher_id", 1), ("created_at", -1)],
            [("status", 1), ("due_at", 1)],
        ]
