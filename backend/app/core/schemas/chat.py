"""Chat log schemas for API requests and responses."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class ChatAIMetaResponse(BaseModel):
    """Lightweight AI routing metadata for student-side display."""

    primary_agent: Optional[str] = None
    rationale_summary: Optional[str] = None
    routing_summary: Optional[List[str]] = None


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
