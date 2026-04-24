"""Schemas for project Wiki and lightweight RAG grounding."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class WikiItemCreateRequest(BaseModel):
    """Request schema for creating a Wiki item."""

    project_id: str
    group_id: Optional[str] = None
    stage_id: Optional[str] = None
    item_type: str = Field(
        default="note",
        pattern="^(task_brief|concept|evidence|claim|controversy|stage_summary|note)$",
    )
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1)
    summary: Optional[str] = Field(default=None, max_length=500)
    source_type: str = Field(
        default="manual",
        pattern="^(teacher_brief|document|chat|inquiry|ai|manual|system)$",
    )
    source_id: Optional[str] = None
    source_event_ids: List[str] = Field(default_factory=list)
    linked_item_ids: List[str] = Field(default_factory=list)
    visibility: str = Field(default="project", pattern="^(project|group)$")
    confidence_level: str = Field(
        default="unverified",
        pattern="^(unverified|working|verified)$",
    )


class WikiItemUpdateRequest(BaseModel):
    """Request schema for updating a Wiki item."""

    group_id: Optional[str] = None
    stage_id: Optional[str] = None
    item_type: Optional[str] = Field(
        default=None,
        pattern="^(task_brief|concept|evidence|claim|controversy|stage_summary|note)$",
    )
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    content: Optional[str] = Field(default=None, min_length=1)
    summary: Optional[str] = Field(default=None, max_length=500)
    source_event_ids: Optional[List[str]] = None
    linked_item_ids: Optional[List[str]] = None
    visibility: Optional[str] = Field(default=None, pattern="^(project|group)$")
    confidence_level: Optional[str] = Field(
        default=None,
        pattern="^(unverified|working|verified)$",
    )


class WikiItemResponse(BaseModel):
    """Response schema for a Wiki item."""

    id: str
    project_id: str
    group_id: Optional[str] = None
    stage_id: Optional[str] = None
    item_type: str
    title: str
    content: str
    summary: Optional[str] = None
    source_type: str
    source_id: Optional[str] = None
    source_event_ids: List[str] = Field(default_factory=list)
    linked_item_ids: List[str] = Field(default_factory=list)
    created_by: str
    updated_by: Optional[str] = None
    visibility: str
    confidence_level: str
    created_at: datetime
    updated_at: datetime


class WikiItemListResponse(BaseModel):
    """List response for Wiki items."""

    items: List[WikiItemResponse]
    total: int


class WikiSearchResponse(BaseModel):
    """Search response for Wiki items."""

    items: List[WikiItemResponse]
    total: int
    query: str
