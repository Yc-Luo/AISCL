"""Document management API routes."""

import base64
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.v1.auth import get_current_user
from app.core.permissions import can_edit_project_content, can_manage_project_scope, check_project_member_permission
from app.repositories.document import Document, DocumentVersion
from app.repositories.project import Project
from app.repositories.user import User
from app.core.schemas.document import (
    DocumentCreateRequest,
    DocumentDetailResponse,
    DocumentListResponse,
    DocumentReorderRequest,
    DocumentResponse,
    DocumentUpdateRequest,
    DocumentVersionListResponse,
    DocumentVersionResponse,
)

router = APIRouter(prefix="/documents", tags=["documents"])


def document_scope(document: Document) -> str:
    """Return a backward-compatible document scope."""
    return getattr(document, "scope", None) or "shared"


def document_owner_id(document: Document) -> Optional[str]:
    """Return the explicit owner, falling back to the creator-like modifier for old records."""
    return getattr(document, "owner_id", None) or getattr(document, "last_modified_by", None)


def is_document_owner(current_user: User, document: Document) -> bool:
    return str(current_user.id) == document_owner_id(document)


async def can_access_document(current_user: User, project: Project, document: Document) -> bool:
    """Check document visibility within a project."""
    if document_scope(document) != "personal":
        return await check_project_member_permission(current_user, project)
    if is_document_owner(current_user, document):
        return True
    return await can_manage_project_scope(current_user, project)


async def can_update_document(current_user: User, project: Project, document: Document) -> bool:
    """Check whether the user can update this document."""
    if document_scope(document) == "personal":
        return is_document_owner(current_user, document) or await can_manage_project_scope(current_user, project)
    return await check_project_member_permission(current_user, project)


async def can_delete_document(current_user: User, project: Project, document: Document) -> bool:
    """Check whether the user can delete this document."""
    if document_scope(document) == "personal":
        return is_document_owner(current_user, document) or await can_manage_project_scope(current_user, project)
    return await can_manage_project_scope(current_user, project)


async def document_visibility_query(project_id: str, current_user: User, project: Project) -> dict:
    """Build a query that returns shared documents plus the user's personal documents."""
    if await can_manage_project_scope(current_user, project):
        return {"project_id": project_id}
    return {
        "project_id": project_id,
        "$or": [
            {"scope": {"$ne": "personal"}},
            {"owner_id": str(current_user.id)},
        ],
    }


def to_document_response(document: Document) -> DocumentResponse:
    """Convert a document model to the public response schema."""
    return DocumentResponse(
        id=str(document.id),
        project_id=document.project_id,
        title=document.title,
        content=document.content,
        preview_text=document.preview_text,
        scope=document_scope(document),
        owner_id=document_owner_id(document),
        last_modified_by=document.last_modified_by,
        is_archived=document.is_archived,
        source_type=document.source_type,
        course_task_release_id=document.course_task_release_id,
        sort_order=getattr(document, "sort_order", 0),
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


async def ensure_project_access(current_user: User, project: Project, detail: str) -> None:
    """Ensure current user can access a project-scoped document resource."""
    if not await check_project_member_permission(current_user, project):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
        )


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

    await ensure_project_access(
        current_user,
        project,
        "You don't have permission to access this project",
    )

    # Build query
    query = await document_visibility_query(project_id, current_user, project)
    if archived is not None:
        query["is_archived"] = archived

    # Get documents. Existing records without a custom order keep the previous
    # updated-at behavior until the group explicitly reorders the list.
    all_documents = await Document.find(query).sort("-updated_at").to_list()
    if any(getattr(doc, "sort_order", 0) for doc in all_documents):
        all_documents.sort(key=lambda doc: (getattr(doc, "sort_order", 0), doc.created_at))
    documents_list = all_documents[skip: skip + limit]
    total = await Document.find(query).count()

    return DocumentListResponse(
        documents=[to_document_response(doc) for doc in documents_list],
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

    await ensure_project_access(
        current_user,
        project,
        "You don't have permission to create documents in this project",
    )

    # Create document with empty content state
    from datetime import datetime

    new_document = Document(
        project_id=project_id,
        title=document_data.title,
        content=document_data.content,
        content_state=b"",  # Empty initial state
        preview_text=None,
        scope=document_data.scope,
        owner_id=str(current_user.id),
        last_modified_by=str(current_user.id),
        sort_order=await Document.find({"project_id": project_id}).count(),
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

    return to_document_response(new_document)


@router.put("/projects/{project_id}/order", response_model=DocumentListResponse)
async def reorder_documents(
    project_id: str,
    reorder_data: DocumentReorderRequest,
    current_user: User = Depends(get_current_user),
) -> DocumentListResponse:
    """Persist the visible order of project documents."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    if not await can_edit_project_content(current_user, project):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only editor and owner can reorder documents",
        )

    visible_query = await document_visibility_query(project_id, current_user, project)
    documents = await Document.find(visible_query).to_list()
    documents_by_id = {str(document.id): document for document in documents}
    requested_ids = reorder_data.document_ids
    if len(set(requested_ids)) != len(requested_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Document order contains duplicate documents",
        )
    missing_ids = [document_id for document_id in requested_ids if document_id not in documents_by_id]
    if missing_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Document order contains documents outside this project",
        )

    requested_id_set = set(requested_ids)
    ordered_ids = requested_ids + [document_id for document_id in documents_by_id if document_id not in requested_id_set]
    for index, document_id in enumerate(ordered_ids):
        document = documents_by_id[document_id]
        document.sort_order = index
        await document.save()

    ordered_documents = [documents_by_id[document_id] for document_id in ordered_ids]

    return DocumentListResponse(
        documents=[to_document_response(doc) for doc in ordered_documents],
        total=len(ordered_documents),
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

    if not await can_access_document(current_user, project, document):
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
        scope=document_scope(document),
        owner_id=document_owner_id(document),
        last_modified_by=document.last_modified_by,
        is_archived=document.is_archived,
        source_type=document.source_type,
        course_task_release_id=document.course_task_release_id,
        sort_order=getattr(document, "sort_order", 0),
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

    # Check permission
    if not await can_update_document(current_user, project, document):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to update this document",
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
    if document_data.scope:
        if document_data.scope == "personal" and document_scope(document) == "shared":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Shared documents cannot be converted back to personal documents",
            )
        if document_data.scope == "shared" and document_scope(document) == "personal":
            if not (is_document_owner(current_user, document) or await can_manage_project_scope(current_user, project)):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Only the document owner can share a personal document",
                )
            document.scope = "shared"
        
    document.last_modified_by = str(current_user.id)
    if not getattr(document, "owner_id", None):
        document.owner_id = str(current_user.id)
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

    return to_document_response(document)


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

    # Shared documents are managed at project scope; personal documents can also be deleted by their owner.
    if not await can_delete_document(current_user, project, document):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to delete this document",
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

    if not await can_access_document(current_user, project, document):
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
