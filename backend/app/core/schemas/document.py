"""Document schemas for API requests and responses."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class DocumentCreateRequest(BaseModel):
    """Request schema for creating a document."""

    title: str = Field(..., min_length=1, max_length=200)
    content: Optional[str] = None
    scope: str = Field(default="shared", pattern="^(shared|personal)$")


class DocumentUpdateRequest(BaseModel):
    """Request schema for updating a document."""

    title: Optional[str] = Field(None, min_length=1, max_length=200)
    content: Optional[str] = None
    scope: Optional[str] = Field(None, pattern="^(shared|personal)$")


class DocumentReorderRequest(BaseModel):
    """Request schema for persisting project document order."""

    document_ids: List[str] = Field(..., min_items=1, max_items=100)


class DocumentResponse(BaseModel):
    """Response schema for a document."""

    id: str
    project_id: str
    title: str
    content: Optional[str] = None
    preview_text: Optional[str] = None
    scope: str = "shared"
    owner_id: Optional[str] = None
    last_modified_by: str
    is_archived: bool
    source_type: Optional[str] = None
    course_task_release_id: Optional[str] = None
    sort_order: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class DocumentDetailResponse(BaseModel):
    """Response schema for document detail (includes content state)."""

    id: str
    project_id: str
    title: str
    content: Optional[str] = None  # HTML content
    content_state: str  # Y.js ProseMirror state (base64 encoded)
    preview_text: Optional[str] = None
    scope: str = "shared"
    owner_id: Optional[str] = None
    last_modified_by: str
    is_archived: bool
    source_type: Optional[str] = None
    course_task_release_id: Optional[str] = None
    sort_order: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class DocumentListResponse(BaseModel):
    """Response schema for document list."""

    documents: List[DocumentResponse]
    total: int


class DocumentVersionResponse(BaseModel):
    """Response schema for a document version."""

    id: str
    document_id: str
    version_number: int
    content_state: str  # Y.js ProseMirror state (base64 encoded)
    created_by: str
    created_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class DocumentVersionListResponse(BaseModel):
    """Response schema for document version list."""

    versions: List[DocumentVersionResponse]
    total: int
