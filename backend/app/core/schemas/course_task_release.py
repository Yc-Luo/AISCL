"""Schemas for course-level group task releases."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class CourseTaskReleaseCreateRequest(BaseModel):
    """Create and publish a group task to a course."""

    title: str = Field(..., min_length=1, max_length=200)
    task_brief_html: Optional[str] = Field(default=None, max_length=3_000_000)
    task_background: Optional[str] = Field(default=None, max_length=3000)
    core_question: Optional[str] = Field(default=None, max_length=3000)
    collaboration_requirements: Optional[str] = Field(default=None, max_length=3000)
    deliverable_requirements: Optional[str] = Field(default=None, max_length=3000)
    evaluation_points: Optional[str] = Field(default=None, max_length=3000)
    due_at: Optional[datetime] = None
    allow_late_submission: bool = True


class CourseTaskReleaseResponse(BaseModel):
    """Course task release response."""

    id: str
    course_id: str
    course_name: Optional[str] = None
    teacher_id: str
    title: str
    task_brief_html: Optional[str] = None
    task_background: Optional[str] = None
    core_question: Optional[str] = None
    collaboration_requirements: Optional[str] = None
    deliverable_requirements: Optional[str] = None
    evaluation_points: Optional[str] = None
    due_at: Optional[str] = None
    allow_late_submission: bool
    status: str
    target_project_ids: List[str] = Field(default_factory=list)
    target_project_count: int = 0
    synced_task_ids: List[str] = Field(default_factory=list)
    synced_task_count: int = 0
    synced_document_ids: List[str] = Field(default_factory=list)
    synced_document_count: int = 0
    submitted_count: int = 0
    manual_submitted_count: int = 0
    late_submitted_count: int = 0
    auto_submitted_count: int = 0
    created_by: str
    created_at: str
    updated_at: str
    published_at: str
    closed_at: Optional[str] = None


class CourseTaskReleaseListResponse(BaseModel):
    """Course task release list response."""

    releases: List[CourseTaskReleaseResponse]
