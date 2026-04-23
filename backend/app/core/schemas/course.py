"""Course schemas."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class CourseResponse(BaseModel):
    """Course response schema."""

    id: str
    name: str
    teacher_id: str
    semester: str
    invite_code: str
    students: List[str] = Field(default_factory=list)
    description: Optional[str] = None
    experiment_template_key: Optional[str] = None
    experiment_template_label: Optional[str] = None
    experiment_template_release_id: Optional[str] = None
    experiment_template_release_note: Optional[str] = None
    experiment_template_source: Optional[str] = None
    experiment_template_bound_at: Optional[datetime] = None
    initial_task_document_title: Optional[str] = None
    initial_task_document_content: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class CourseCreateRequest(BaseModel):
    """Course create request schema."""

    name: str = Field(..., min_length=1, max_length=100)
    semester: str
    description: Optional[str] = None
    experiment_template_key: Optional[str] = None
    initial_task_document_title: Optional[str] = None
    initial_task_document_content: Optional[str] = None


class CourseUpdateRequest(BaseModel):
    """Course update request schema."""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    experiment_template_key: Optional[str] = None
    initial_task_document_title: Optional[str] = None
    initial_task_document_content: Optional[str] = None


class CourseJoinRequest(BaseModel):
    """Course join request schema."""

    invite_code: str = Field(..., min_length=6, max_length=6)


class CourseListResponse(BaseModel):
    """Course list response schema."""

    courses: List[CourseResponse]
