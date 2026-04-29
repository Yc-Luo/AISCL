"""Project model."""

from datetime import datetime
from typing import List, Optional

from beanie import Document
from pydantic import Field


class ProjectMember(Document):
    """Project member schema."""

    user_id: str
    role: str = Field(pattern="^(owner|editor|viewer)$")
    joined_at: datetime = Field(default_factory=datetime.utcnow)


class Project(Document):
    """Project document model."""

    name: str = Field(..., min_length=3, max_length=50)
    subtitle: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    course_id: Optional[str] = Field(default=None)
    owner_id: str
    leader_id: Optional[str] = Field(default=None)
    members: List[dict] = Field(default_factory=list)  # List of ProjectMember-like dicts
    progress: int = Field(default=0, ge=0, le=100)
    is_template: bool = False
    is_archived: bool = False
    experiment_version: Optional[dict] = None
    inherited_template_key: Optional[str] = None
    inherited_template_label: Optional[str] = None
    inherited_template_release_id: Optional[str] = None
    inherited_template_source: Optional[str] = None
    initial_task_document_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "projects"
        indexes = [
            [("owner_id", 1)],
            [("leader_id", 1)],
            [("course_id", 1)],
            [("members.user_id", 1)],
            [("is_archived", 1)],
            [("created_at", 1)],  # For sorting projects by creation date
            [("owner_id", 1), ("is_archived", 1)],  # For user's active projects
            [("is_template", 1)],  # For template queries
            [("progress", 1)],  # For progress filtering
        ]
