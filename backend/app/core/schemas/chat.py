"""Chat log schemas for API requests and responses."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class ChatAIMetaResponse(BaseModel):
    """Lightweight AI routing metadata for student-side display."""

    primary_agent: Optional[str] = None
    rationale_summary: Optional[str] = None
    routing_summary: Optional[List[str]] = None


class ChatTeacherSupportMetaResponse(BaseModel):
    """Teacher support metadata attached to group-chat messages."""

    support_type: Optional[str] = None
    source: Optional[str] = None


class ChatTeacherHelpRequestMetaResponse(BaseModel):
    """Student help request metadata attached to group-chat messages."""

    help_type: Optional[str] = None
    status: str = "pending"
    source: Optional[str] = None
    allow_public_reply: bool = False
    page_source: Optional[str] = None
    stage_id: Optional[str] = None


class ChatFileInfoResponse(BaseModel):
    """File metadata attached to a chat message."""

    name: str
    size: int = 0
    url: str
    mime_type: Optional[str] = None
    resource_id: Optional[str] = None


class ChatLogResponse(BaseModel):
    """Response schema for a chat log message."""

    id: str
    client_message_id: Optional[str] = None
    project_id: str
    user_id: str
    username: str
    avatar_url: Optional[str] = None
    content: str
    message_type: str
    mentions: List[str]
    ai_meta: Optional[ChatAIMetaResponse] = None
    teacher_support: Optional[ChatTeacherSupportMetaResponse] = None
    teacher_help_request: Optional[ChatTeacherHelpRequestMetaResponse] = None
    file_info: Optional[ChatFileInfoResponse] = None
    created_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class ChatLogListResponse(BaseModel):
    """Response schema for chat log list."""

    messages: List[ChatLogResponse]
    total: int


class TeacherSupportMessageRequest(BaseModel):
    """Teacher-side low-frequency support message sent to group chat."""

    content: str = Field(..., min_length=1, max_length=1000)
    support_type: Optional[str] = Field(default=None, max_length=50)


class TeacherHelpRequestCreate(BaseModel):
    """Student-side low-frequency request for teacher support."""

    content: str = Field(..., min_length=1, max_length=1000)
    help_type: Optional[str] = Field(default=None, max_length=50)
    allow_public_reply: bool = False
    stage_id: Optional[str] = Field(default=None, max_length=100)
    page_source: Optional[str] = Field(default=None, max_length=100)


class TeacherHelpReplyCreate(BaseModel):
    """Teacher reply to a student help request."""

    content: str = Field(..., min_length=1, max_length=1000)
    support_type: Optional[str] = Field(default=None, max_length=50)
    public_reply: bool = False


class TeacherHelpRequestStatusUpdate(BaseModel):
    """Teacher-side status update for a help request."""

    status: str = Field(..., pattern="^(pending|replied|resolved)$")


class TeacherHelpRequestResponse(BaseModel):
    """Teacher monitor response for a student help request."""

    id: str
    project_id: str
    user_id: str
    username: str
    content: str
    help_type: Optional[str] = None
    allow_public_reply: bool = False
    stage_id: Optional[str] = None
    page_source: Optional[str] = None
    status: str
    created_at: datetime
    replies: List["TeacherHelpReplyResponse"] = Field(default_factory=list)


class TeacherHelpRequestListResponse(BaseModel):
    """List response for student help requests."""

    requests: List[TeacherHelpRequestResponse]
    total: int


class TeacherHelpReplyResponse(BaseModel):
    """Reply attached to a student help request."""

    id: str
    project_id: str
    user_id: str
    username: str
    content: str
    support_type: Optional[str] = None
    public_reply: bool = False
    created_at: datetime


TeacherHelpRequestResponse.model_rebuild()
