"""Export job model for long-running research package generation."""

from datetime import datetime
from typing import Optional

from beanie import Document
from pydantic import Field
from pymongo import IndexModel


class ExportJob(Document):
    """Asynchronous export job state."""

    job_type: str = Field(default="course_research_package", index=True)
    status: str = Field(default="queued", pattern="^(queued|running|completed|failed|expired)$", index=True)
    course_id: str = Field(..., index=True)
    course_name: Optional[str] = None
    requested_by: str = Field(..., index=True)
    include_files: bool = False
    include_raw_heartbeat: bool = False
    progress: int = Field(default=0, ge=0, le=100)
    message: str = ""
    filename: Optional[str] = None
    file_path: Optional[str] = None
    file_size: int = 0
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "export_jobs"
        indexes = [
            [("requested_by", 1), ("created_at", -1)],
            [("course_id", 1), ("created_at", -1)],
            [("status", 1), ("created_at", -1)],
            IndexModel([("created_at", 1)], expireAfterSeconds=604800),
        ]
