"""Document comment API routes."""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.v1.auth import get_current_user
from app.core.permissions import check_project_permission
from app.repositories.doc_comment import DocComment
from app.repositories.document import Document
from app.repositories.project import Project
from app.repositories.user import User
from app.core.schemas.comment import (
    CommentCreateRequest,
    CommentListResponse,
    CommentResponse,
    CommentStatusUpdateRequest,
)

router = APIRouter(prefix="/comments", tags=["comments"])


@router.get("/documents/{doc_id}", response_model=CommentListResponse)
async def get_document_comments(
    doc_id: str,
    status_filter: Optional[str] = Query(None, pattern="^(open|resolved)$"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    current_user: User = Depends(get_current_user),
) -> CommentListResponse:
    """Get comments for a document."""
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

    # Build query
    query = {"document_id": doc_id}
    if status_filter:
        query["status"] = status_filter

    # Get comments
    comments_cursor = DocComment.find(query).skip(skip).limit(limit).sort("-created_at")
    comments_list = await comments_cursor.to_list()
    total = await DocComment.find(query).count()

    return CommentListResponse(
        comments=[
            CommentResponse(
                id=str(c.id),
                document_id=c.document_id,
                anchor_context=c.anchor_context,
                status=c.status,
                mentioned_user_ids=c.mentioned_user_ids,
                messages=[
                    {
                        "user_id": msg.get("user_id"),
                        "content": msg.get("content"),
                        "created_at": msg.get("created_at"),
                    }
                    for msg in c.messages
                ],
                created_by=c.created_by,
                created_at=c.created_at,
                updated_at=c.updated_at,
            )
            for c in comments_list
        ],
        total=total,
    )


@router.post(
    "/documents/{doc_id}",
    response_model=CommentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_comment(
    doc_id: str,
    comment_data: CommentCreateRequest,
    current_user: User = Depends(get_current_user),
) -> CommentResponse:
    """Create a comment on a document."""
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
                detail="You don't have permission to comment on this document",
            )

    # Create comment
    from datetime import datetime

    new_comment = DocComment(
        document_id=doc_id,
        anchor_context=comment_data.anchor_context,
        status="open",
        mentioned_user_ids=comment_data.mentioned_user_ids or [],
        messages=[
            {
                "user_id": str(current_user.id),
                "content": comment_data.content,
                "created_at": datetime.utcnow(),
            }
        ],
        created_by=str(current_user.id),
    )
    await new_comment.insert()

    return CommentResponse(
        id=str(new_comment.id),
        document_id=new_comment.document_id,
        anchor_context=new_comment.anchor_context,
        status=new_comment.status,
        mentioned_user_ids=new_comment.mentioned_user_ids,
        messages=[
            {
                "user_id": msg.get("user_id"),
                "content": msg.get("content"),
                "created_at": msg.get("created_at"),
            }
            for msg in new_comment.messages
        ],
        created_by=new_comment.created_by,
        created_at=new_comment.created_at,
        updated_at=new_comment.updated_at,
    )


@router.put("/{comment_id}/status", response_model=CommentResponse)
async def update_comment_status(
    comment_id: str,
    status_data: CommentStatusUpdateRequest,
    current_user: User = Depends(get_current_user),
) -> CommentResponse:
    """Update comment status (open/resolved)."""
    comment = await DocComment.get(comment_id)
    if not comment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comment not found",
        )

    # Check document and project access
    document = await Document.get(comment.document_id)
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )

    project = await Project.get(document.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Check permission (Editor/Owner can resolve comments)
    is_owner = str(current_user.id) == project.owner_id
    is_editor = any(
        m.get("user_id") == str(current_user.id)
        and m.get("role") in ["owner", "editor"]
        for m in project.members
    )
    # Comment creator can also update status
    is_creator = str(current_user.id) == comment.created_by

    if not (is_owner or is_editor or is_creator) and current_user.role not in [
        "admin",
        "teacher",
    ]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to update this comment",
        )

    # Update status
    from datetime import datetime

    comment.status = status_data.status
    comment.updated_at = datetime.utcnow()
    await comment.save()

    return CommentResponse(
        id=str(comment.id),
        document_id=comment.document_id,
        anchor_context=comment.anchor_context,
        status=comment.status,
        mentioned_user_ids=comment.mentioned_user_ids,
        messages=[
            {
                "user_id": msg.get("user_id"),
                "content": msg.get("content"),
                "created_at": msg.get("created_at"),
            }
            for msg in comment.messages
        ],
        created_by=comment.created_by,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
    )

