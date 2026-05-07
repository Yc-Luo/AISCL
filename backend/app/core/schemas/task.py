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


class TaskListResponse(BaseModel):
    """Task list response schema."""

    tasks: List[TaskResponse]
