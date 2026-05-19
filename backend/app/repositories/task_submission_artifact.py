"""Submitted artifact model for teacher-released group tasks."""

from datetime import datetime
from typing import Optional

from beanie import Document
from pydantic import Field


class TaskSubmissionArtifact(Document):
    """File artifact uploaded as part of a group task submission."""

    task_id: str = Field(..., index=True)
    project_id: str = Field(..., index=True)
    course_id: Optional[str] = Field(default=None, index=True)
    course_task_release_id: Optional[str] = Field(default=None, index=True)
    filename: str = Field(..., max_length=255)
    file_key: str
    mime_type: str = Field(..., max_length=160)
    size: int = Field(..., ge=1)
    artifact_type: str = Field(default="other", pattern="^(document|slides|image|video|archive|other)$")
    checksum_sha256: Optional[str] = Field(default=None, max_length=64)
    uploaded_by: str = Field(..., index=True)
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "task_submission_artifacts"
        indexes = [
            [("task_id", 1)],
            [("project_id", 1)],
            [("course_id", 1)],
            [("course_task_release_id", 1)],
            [("uploaded_by", 1)],
            [("uploaded_at", -1)],
        ]
