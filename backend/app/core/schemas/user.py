"""User schemas."""

from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, EmailStr, Field


class UserResponse(BaseModel):
    """User response schema."""

    id: str
    username: str
    email: EmailStr
    phone: Optional[str] = None
    avatar_url: Optional[str] = None
    role: str
    settings: Dict = Field(default_factory=dict)
    class_id: Optional[str] = None
    is_active: bool
    created_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class UserUpdateRequest(BaseModel):
    """User update request schema."""

    username: Optional[str] = Field(None, min_length=3, max_length=50)
    avatar_url: Optional[str] = None
    settings: Optional[Dict] = None


class UserCreateRequest(BaseModel):
    """User create request schema."""

    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    phone: Optional[str] = None
    password: str = Field(..., min_length=8)
    role: str = Field(default="student", pattern="^(student|teacher|admin)$")
    class_id: Optional[str] = None


class UserListResponse(BaseModel):
    """User list response schema."""

    users: List[UserResponse]

