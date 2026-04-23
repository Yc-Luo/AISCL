"""Project schemas."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class ProjectMemberResponse(BaseModel):
    """Project member response schema."""

    user_id: str
    role: str
    joined_at: datetime


class ProjectResponse(BaseModel):
    """Project response schema."""

    id: str
    name: str
    subtitle: Optional[str] = None
    description: Optional[str] = None
    course_id: Optional[str] = None
    owner_id: str
    members: List[ProjectMemberResponse] = Field(default_factory=list)
    progress: int = Field(ge=0, le=100)
    is_template: bool = False
    is_archived: bool = False
    inherited_template_key: Optional[str] = None
    inherited_template_label: Optional[str] = None
    inherited_template_release_id: Optional[str] = None
    inherited_template_source: Optional[str] = None
    initial_task_document_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class ProjectCreateRequest(BaseModel):
    """Project create request schema."""

    name: str = Field(..., min_length=3, max_length=50)
    subtitle: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    course_id: Optional[str] = None
    inherit_course_template: bool = True


class ProjectUpdateRequest(BaseModel):
    """Project update request schema."""

    name: Optional[str] = Field(None, min_length=3, max_length=50)
    subtitle: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    progress: Optional[int] = Field(None, ge=0, le=100)
    is_archived: Optional[bool] = None


class ProjectMemberAddRequest(BaseModel):
    """Project member add request schema."""

    user_id: Optional[str] = None
    email: Optional[str] = None
    role: str = Field(default="editor", pattern="^(owner|editor|viewer)$")


class ProjectListResponse(BaseModel):
    """Project list response schema."""

    projects: List[ProjectResponse]
    total: int
