"""Web annotation schemas for API requests and responses."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class WebAnnotationCreateRequest(BaseModel):
    """Request schema for creating a web annotation."""

    target_url: str = Field(..., max_length=2000)
    selector: dict = Field(..., description="CSS selector or text position")
    annotation_type: str = Field(..., pattern="^(highlight|sticky_note)$")
    color: Optional[str] = Field(None, pattern="^#[0-9A-Fa-f]{6}$")
    content: Optional[str] = Field(None, max_length=1000)


class WebAnnotationUpdateRequest(BaseModel):
    """Request schema for updating a web annotation."""

    color: Optional[str] = Field(None, pattern="^#[0-9A-Fa-f]{6}$")
    content: Optional[str] = Field(None, max_length=1000)


class WebAnnotationResponse(BaseModel):
    """Response schema for a web annotation."""

    id: str
    project_id: str
    url_hash: str
    target_url: str
    selector: dict
    annotation_type: str
    color: Optional[str]
    content: Optional[str]
    author_id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class WebAnnotationListResponse(BaseModel):
    """Response schema for web annotation list."""

    annotations: List[WebAnnotationResponse]
    total: int


class WebScrapeRequest(BaseModel):
    """Request schema for web scraping."""

    url: str = Field(..., max_length=2000)


class WebScrapeResponse(BaseModel):
    """Response schema for web scraping."""

    url: str
    url_hash: str
    title: str
    content: str
    cleaned_html: str

