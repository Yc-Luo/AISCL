"""Collaboration API routes."""

import base64
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from typing import Dict, Any

from app.api.v1.auth import get_current_user
from app.core.permissions import can_edit_project_content, can_manage_project_scope, check_project_member_permission
from app.repositories.document import Document
from app.repositories.project import Project
from app.repositories.user import User
from app.repositories.collaboration_snapshot import CollaborationSnapshot
from app.core.schemas.analytics import SuccessResponse

router = APIRouter(prefix="/collaboration", tags=["collaboration"])


async def get_accessible_project(project_id: str, current_user: User) -> Project:
    """Load a project and ensure current user can access it."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if not await check_project_member_permission(current_user, project):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission")
    return project


async def get_accessible_snapshot_project(resource_id: str, snapshot_type: str, current_user: User) -> Project:
    """Resolve snapshot resource access.

    For document snapshots, the route id is a document id rather than a project id.
    Whiteboard and inquiry snapshots still use the project id directly.
    """
    if snapshot_type == "document":
        document = await Document.get(resource_id)
        if not document:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
        project = await get_accessible_project(document.project_id, current_user)
        document_scope = getattr(document, "scope", None) or "shared"
        if document_scope == "personal":
            owner_id = getattr(document, "owner_id", None) or document.last_modified_by
            if str(current_user.id) != owner_id and not await can_manage_project_scope(current_user, project):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission")
        return project

    return await get_accessible_project(resource_id, current_user)


@router.get("/projects/{project_id}/snapshot")
async def get_snapshot(
    project_id: str,
    type: str = Query("whiteboard", description="Type of snapshot: whiteboard, document, inquiry"),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Get the latest snapshot for a project/resource."""
    await get_accessible_snapshot_project(project_id, type, current_user)
    if type == "document":
        document = await Document.get(project_id)
        if not document:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
        if not document.content_state:
            return {"project_id": project_id, "snapshot": None}
        return {
            "project_id": project_id,
            "snapshot": {"data": base64.b64encode(document.content_state).decode("utf-8"), "type": "document"},
            "updated_at": document.updated_at,
        }

    # Note: Currently project_id field in DB is used as generic resource ID.
    snapshot = await CollaborationSnapshot.get_latest(project_id)
    
    if not snapshot:
        return {"project_id": project_id, "snapshot": None}
        
    return {
        "project_id": project_id,
        "snapshot": snapshot.snapshot_data,
        "updated_at": snapshot.updated_at
    }

@router.post("/projects/{project_id}/snapshot", response_model=SuccessResponse)
async def save_snapshot(
    project_id: str,
    snapshot_data: Dict[str, Any],
    type: str = Query("whiteboard"),
    current_user: User = Depends(get_current_user),
) -> SuccessResponse:
    """Save a snapshot."""
    effective_type = snapshot_data.get("type") or type
    project = await get_accessible_snapshot_project(project_id, effective_type, current_user)
    if effective_type == "document":
        document = await Document.get(project_id)
        if not document:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
        try:
            document.content_state = base64.b64decode(snapshot_data.get("data") or "")
        except Exception:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid document snapshot")
        document.last_modified_by = str(current_user.id)
        document.updated_at = datetime.utcnow()
        await document.save()
        return SuccessResponse(message="Snapshot saved successfully")

    if effective_type != "document" and not await can_edit_project_content(current_user, project):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission")
    snapshot = CollaborationSnapshot(
        project_id=project_id,
        snapshot_data=snapshot_data
    )
    await snapshot.save()
    
    return SuccessResponse(message="Snapshot saved successfully")
