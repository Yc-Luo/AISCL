"""User model."""

from datetime import datetime
from typing import Dict, List, Optional

from beanie import Document
from pydantic import Field


class UserSettings(Document):
    """User settings schema."""

    theme: str = "light"
    language: str = "zh"
    notifications_enabled: bool = True


class User(Document):
    """User document model."""

    username: Optional[str] = Field(None, min_length=1, max_length=50)
    email: str
    phone: Optional[str] = None
    password_hash: str
    avatar_url: Optional[str] = None
    role: str = Field(default="student", pattern="^(student|teacher|admin)$")
    settings: Dict = Field(default_factory=dict)
    teacher_tags: List[str] = Field(default_factory=list)
    config_permissions: Optional[Dict] = None
    class_id: Optional[str] = None  # For students, link to course
    is_active: bool = True
    is_banned: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "users"
        indexes = [
            [("username", 1)],
            [("email", 1)],
            [("phone", 1)],
            [("class_id", 1)],
            [("role", 1)],  # For role-based queries
            [("teacher_tags", 1)],
            [("is_active", 1)],  # For filtering active users
            [("created_at", 1)],  # For user sorting
            [("class_id", 1), ("role", 1)],  # For class-based role queries
        ]
