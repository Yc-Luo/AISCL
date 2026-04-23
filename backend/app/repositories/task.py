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
    due_date: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "tasks"
        indexes = [
            [("project_id", 1)],
            [("project_id", 1), ("column", 1)],
        ]

