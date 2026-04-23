"""Document management API routes."""

import base64
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.v1.auth import get_current_user
from app.core.permissions import check_project_permission
from app.repositories.document import Document, DocumentVersion
from app.repositories.project import Project
from app.repositories.user import User
from app.core.schemas.document import (
    DocumentCreateRequest,
    DocumentDetailResponse,
    DocumentListResponse,
    DocumentResponse,
    DocumentUpdateRequest,
    DocumentVersionListResponse,
    DocumentVersionResponse,
)

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("/projects/{project_id}", response_model=DocumentListResponse)
async def get_documents(
    project_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    archived: Optional[bool] = None,
    current_user: User = Depends(get_current_user),
) -> DocumentListResponse:
    """Get documents for a project."""
    # Check project access
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Check permission
    if not check_project_permission(
        current_user, project.owner_id, current_user.role
    ):
        is_member = any(
            m.get("user_id") == str(current_user.id) for m in project.members
        )
        if not is_member and current_user.role not in ["admin", "teacher"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to access this project",
            )

    # Build query
    query = {"project_id": project_id}
    if archived is not None:
        query["is_archived"] = archived

    # Get documents
    documents_cursor = Document.find(query).skip(skip).limit(limit).sort("-updated_at")
    documents_list = await documents_cursor.to_list()
    total = await Document.find(query).count()

    return DocumentListResponse(
        documents=[
            DocumentResponse(
                id=str(doc.id),
                project_id=doc.project_id,
                title=doc.title,
                content=doc.content,
                preview_text=doc.preview_text,
                last_modified_by=doc.last_modified_by,
                is_archived=doc.is_archived,
                created_at=doc.created_at,
                updated_at=doc.updated_at,
            )
            for doc in documents_list
        ],
        total=total,
    )


@router.post(
    "/projects/{project_id}",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_document(
    project_id: str,
    document_data: DocumentCreateRequest,
    current_user: User = Depends(get_current_user),
) -> DocumentResponse:
    """Create a new document."""
    # Check project access
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Check permission
    if not check_project_permission(
        current_user, project.owner_id, current_user.role
    ):
        is_member = any(
            m.get("user_id") == str(current_user.id) for m in project.members
        )
        if not is_member and current_user.role not in ["admin", "teacher"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to create documents in this project",
            )

    # Create document with empty content state
    from datetime import datetime

    new_document = Document(
        project_id=project_id,
        title=document_data.title,
        content=document_data.content,
        content_state=b"",  # Empty initial state
        preview_text=None,
        last_modified_by=str(current_user.id),
    )
    await new_document.insert()

    # Log activity
    from app.services.activity_service import activity_service
    await activity_service.log_activity(
        project_id=project_id,
        user_id=str(current_user.id),
        module="document",
        action="create",
        target_id=str(new_document.id)
    )

    return DocumentResponse(
        id=str(new_document.id),
        project_id=new_document.project_id,
        title=new_document.title,
        content=new_document.content,
        preview_text=new_document.preview_text,
        last_modified_by=new_document.last_modified_by,
        is_archived=new_document.is_archived,
        created_at=new_document.created_at,
        updated_at=new_document.updated_at,
    )


@router.get("/{doc_id}", response_model=DocumentDetailResponse)
async def get_document(
    doc_id: str,
    current_user: User = Depends(get_current_user),
) -> DocumentDetailResponse:
    """Get document detail with content state."""
    document = await Document.get(doc_id)
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )

    # Check project access
    project = await Project.get(document.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Check permission
    if not check_project_permission(
        current_user, project.owner_id, current_user.role
    ):
        is_member = any(
            m.get("user_id") == str(current_user.id) for m in project.members
        )
        if not is_member and current_user.role not in ["admin", "teacher"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to access this document",
            )

    return DocumentDetailResponse(
        id=str(document.id),
        project_id=document.project_id,
        title=document.title,
        content=document.content,
        content_state=base64.b64encode(document.content_state).decode('utf-8'),
        preview_text=document.preview_text,
        last_modified_by=document.last_modified_by,
        is_archived=document.is_archived,
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


@router.put("/{doc_id}", response_model=DocumentResponse)
async def update_document(
    doc_id: str,
    document_data: DocumentUpdateRequest,
    current_user: User = Depends(get_current_user),
) -> DocumentResponse:
    """Update document metadata (title) and content."""
    document = await Document.get(doc_id)
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )

    # Check project access
    project = await Project.get(document.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Check permission (Editor/Owner can update)
    is_owner = str(current_user.id) == project.owner_id
    is_editor = any(
        m.get("user_id") == str(current_user.id)
        and m.get("role") in ["owner", "editor"]
        for m in project.members
    )
    if not (is_owner or is_editor) and current_user.role not in ["admin", "teacher"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only editor and owner can update document",
        )

    # Update document
    from datetime import datetime

    if document_data.title:
        document.title = document_data.title
    if document_data.content is not None:
        document.content = document_data.content
        # Update preview text from content (stripped tags usually, but simple slice for now)
        # In real app, strip HTML tags
        document.preview_text = document_data.content[:200] if document_data.content else None
        
    document.updated_at = datetime.utcnow()

    await document.save()

    # Log activity
    from app.services.activity_service import activity_service
    await activity_service.log_activity(
        project_id=str(project.id),
        user_id=str(current_user.id),
        module="document",
        action="update",
        target_id=str(document.id)
    )

    return DocumentResponse(
        id=str(document.id),
        project_id=document.project_id,
        title=document.title,
        content=document.content,
        preview_text=document.preview_text,
        last_modified_by=document.last_modified_by,
        is_archived=document.is_archived,
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    doc_id: str,
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete a document (Owner only)."""
    document = await Document.get(doc_id)
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )

    # Check project access
    project = await Project.get(document.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Only owner can delete
    if str(current_user.id) != project.owner_id and current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only project owner can delete document",
        )

    await document.delete()

    # Log activity
    from app.services.activity_service import activity_service
    await activity_service.log_activity(
        project_id=str(project.id),
        user_id=str(current_user.id),
        module="document",
        action="delete",
        target_id=str(document.id)
    )


@router.get("/{doc_id}/versions", response_model=DocumentVersionListResponse)
async def get_document_versions(
    doc_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
) -> DocumentVersionListResponse:
    """Get document version history."""
    document = await Document.get(doc_id)
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )

    # Check project access
    project = await Project.get(document.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Check permission
    if not check_project_permission(
        current_user, project.owner_id, current_user.role
    ):
        is_member = any(
            m.get("user_id") == str(current_user.id) for m in project.members
        )
        if not is_member and current_user.role not in ["admin", "teacher"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to access this document",
            )

    # Get versions
    versions_cursor = (
        DocumentVersion.find({"document_id": doc_id})
        .skip(skip)
        .limit(limit)
        .sort("-version_number")
    )
    versions_list = await versions_cursor.to_list()
    total = await DocumentVersion.find({"document_id": doc_id}).count()

    return DocumentVersionListResponse(
        versions=[
            DocumentVersionResponse(
                id=str(v.id),
                document_id=v.document_id,
                version_number=v.version_number,
                content_state=base64.b64encode(v.content_state).decode('utf-8'),
                created_by=v.created_by,
                created_at=v.created_at,
            )
            for v in versions_list
        ],
        total=total,
    )

