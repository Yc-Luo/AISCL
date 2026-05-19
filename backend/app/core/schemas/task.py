"""Task schemas."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class TaskResponse(BaseModel):
    """Task response schema."""

    id: str
    project_id: str
    title: str
    column: str
    priority: str
    assignees: List[str] = Field(default_factory=list)
    order: float
    description: Optional[str] = None
    due_date: Optional[str] = None
    source_type: Optional[str] = None
    course_task_release_id: Optional[str] = None
    submission_status: Optional[str] = None
    submitted_at: Optional[str] = None
    submitted_by: Optional[str] = None
    submission_note: Optional[str] = None
    artifact_document_id: Optional[str] = None
    artifact_snapshot_id: Optional[str] = None
    submission_artifact_ids: List[str] = Field(default_factory=list)
    review_status: Optional[str] = None
    review_comment: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[str] = None
    created_at: str
    updated_at: str

    class Config:
        """Pydantic config."""

        from_attributes = True


class TaskCreateRequest(BaseModel):
    """Task create request schema."""

    title: str = Field(..., min_length=1, max_length=200)
    column: str = Field(default="todo", pattern="^(todo|doing|done)$")
    priority: str = Field(default="medium", pattern="^(low|medium|high)$")
    assignees: Optional[List[str]] = None
    description: Optional[str] = Field(None, max_length=10000)
    due_date: Optional[datetime] = None


class TaskUpdateRequest(BaseModel):
    """Task update request schema."""

    title: Optional[str] = Field(None, min_length=1, max_length=200)
    priority: Optional[str] = Field(None, pattern="^(low|medium|high)$")
    assignees: Optional[List[str]] = None
    description: Optional[str] = Field(None, max_length=10000)
    due_date: Optional[datetime] = None


class TaskOrderUpdateRequest(BaseModel):
    """Task order update request schema."""

    prev_order: Optional[float] = None
    next_order: Optional[float] = None


class TaskSubmitRequest(BaseModel):
    """Submit a course-released group task."""

    note: Optional[str] = Field(default=None, max_length=2000)
    artifact_document_id: Optional[str] = Field(default=None, max_length=64)
    artifact_snapshot_id: Optional[str] = Field(default=None, max_length=64)
    artifact_ids: List[str] = Field(default_factory=list, max_length=20)


class TaskArtifactResponse(BaseModel):
    """Submitted task artifact response."""

    id: str
    task_id: str
    project_id: str
    course_id: Optional[str] = None
    course_task_release_id: Optional[str] = None
    filename: str
    file_key: str
    mime_type: str
    size: int
    artifact_type: str
    checksum_sha256: Optional[str] = None
    uploaded_by: str
    uploaded_at: str
    download_url: Optional[str] = None


class TaskArtifactListResponse(BaseModel):
    """Submitted task artifact list response."""

    artifacts: List[TaskArtifactResponse]


class TaskReviewRequest(BaseModel):
    """Teacher review request for a submitted group task."""

    review_status: str = Field(..., pattern="^(reviewed|revision_requested)$")
    review_comment: Optional[str] = Field(default=None, max_length=4000)


class TeacherSubmissionResponse(BaseModel):
    """Teacher-facing submission row."""

    task: TaskResponse
    project_id: str
    project_name: str
    course_id: Optional[str] = None
    course_name: Optional[str] = None
    release_id: Optional[str] = None
    release_title: Optional[str] = None
    artifacts: List[TaskArtifactResponse] = Field(default_factory=list)
    artifact_count: int = 0


class TeacherSubmissionListResponse(BaseModel):
    """Teacher-facing submission list response."""

    submissions: List[TeacherSubmissionResponse]


class TaskListResponse(BaseModel):
    """Task list response schema."""

    tasks: List[TaskResponse]
