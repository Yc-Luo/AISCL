"""Comment schemas for API requests and responses."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class CommentCreateRequest(BaseModel):
    """Request schema for creating a comment."""

    anchor_context: dict = Field(..., description="ProseMirror selection context")
    content: str = Field(..., min_length=1, max_length=1000)
    mentioned_user_ids: Optional[List[str]] = Field(None, description="Mentioned user IDs")


class CommentStatusUpdateRequest(BaseModel):
    """Request schema for updating comment status."""

    status: str = Field(..., pattern="^(open|resolved)$")


class CommentMessageResponse(BaseModel):
    """Response schema for a comment message."""

    user_id: str
    content: str
    created_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class CommentResponse(BaseModel):
    """Response schema for a comment."""

    id: str
    document_id: str
    anchor_context: dict
    status: str
    mentioned_user_ids: List[str]
    messages: List[CommentMessageResponse]
    created_by: str
    created_at: datetime
    updated_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class CommentListResponse(BaseModel):
    """Response schema for comment list."""

    comments: List[CommentResponse]
    total: int

