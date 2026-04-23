"""Calendar event schemas."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class CalendarEventResponse(BaseModel):
    """Calendar event response schema."""

    id: str
    project_id: str
    title: str
    start_time: str
    end_time: str
    type: str
    created_by: str
    is_private: bool
    created_at: str

    class Config:
        """Pydantic config."""

        from_attributes = True


class CalendarEventCreateRequest(BaseModel):
    """Calendar event create request schema."""

    title: str = Field(..., min_length=1, max_length=200)
    start_time: datetime
    end_time: datetime
    type: str = Field(default="meeting", pattern="^(meeting|deadline|personal)$")
    is_private: Optional[bool] = False


class CalendarEventUpdateRequest(BaseModel):
    """Calendar event update request schema."""

    title: Optional[str] = Field(None, min_length=1, max_length=200)
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    is_private: Optional[bool] = None


class CalendarEventListResponse(BaseModel):
    """Calendar event list response schema."""

    events: List[CalendarEventResponse]

