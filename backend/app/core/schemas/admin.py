"""Admin schemas for API requests and responses."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class SystemConfigResponse(BaseModel):
    """Response schema for system configuration."""

    key: str
    value: str
    description: Optional[str]
    updated_by: str
    updated_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class SystemConfigUpdateRequest(BaseModel):
    """Request schema for updating system configuration."""

    value: str
    description: Optional[str] = None


class SystemLogResponse(BaseModel):
    """Response schema for system log."""

    id: str
    log_type: str
    level: str
    module: str
    message: str
    details: Optional[dict]
    user_id: Optional[str]
    ip_address: Optional[str]
    timestamp: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class SystemLogListResponse(BaseModel):
    """Response schema for system log list."""

    logs: List[SystemLogResponse]
    total: int


class UserBanRequest(BaseModel):
    """Request schema for banning/unbanning user."""

    reason: Optional[str] = Field(None, max_length=500)
    duration_days: Optional[int] = Field(None, ge=1)  # None for permanent ban


class UserResponse(BaseModel):
    """Response schema for user info."""

    id: str
    username: str
    email: str
    role: str
    class_id: Optional[str] = None
    course_name: Optional[str] = None
    is_active: bool
    is_banned: bool
    created_at: datetime
    last_active: Optional[datetime] = None


class UserListResponse(BaseModel):
    """Response schema for user list."""

    items: List[UserResponse]
    total: int


class UserCreateRequest(BaseModel):
    """Request schema for creating a user."""

    username: str = Field(..., min_length=1, max_length=50)
    email: str
    password: str = Field(..., min_length=6)
    role: str = Field(..., pattern="^(student|teacher|admin)$")
    class_id: Optional[str] = None


class UserUpdateRequest(BaseModel):
    """Request schema for updating a user."""

    username: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    class_id: Optional[str] = None
    is_active: Optional[bool] = None
    is_banned: Optional[bool] = None


class SystemStatsResponse(BaseModel):
    """Response schema for system statistics."""

    total_users: int
    active_projects: int
    system_load: float
    storage_used: int  # in bytes


class BroadcastRequest(BaseModel):
    """Request schema for broadcasting notification."""

    title: str = Field(..., min_length=1, max_length=100)
    body: str = Field(..., min_length=1, max_length=500)

class ActivityLogResponse(BaseModel):
    """Response schema for activity log."""

    id: str
    project_id: str
    user_id: str
    username: Optional[str] = None
    module: str
    action: str
    target_id: Optional[str] = None
    duration: int
    metadata: Optional[dict] = None
    timestamp: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class ActivityLogListResponse(BaseModel):
    """Response schema for activity log list."""

    logs: List[ActivityLogResponse]
    total: int
