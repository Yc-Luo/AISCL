"""Inquiry space snapshot API routes."""

import base64
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel, Field

from app.api.v1.auth import get_current_user
from app.core.permissions import check_project_member_permission, get_user_role_in_project_sync, can_edit_collaboration
from app.repositories.project import Project
from app.repositories.user import User
from app.services.inquiry_service import inquiry_service
from app.services.activity_service import activity_service

router = APIRouter(prefix="/inquiry", tags=["inquiry"])

class SnapshotRequest(BaseModel):
    """Request model for manual snapshot creation."""
    data: str = Field(..., description="Base64-encoded binary snapshot data from Y.js")

@router.get(
    "/projects/{project_id}/snapshot",
    summary="Get Latest Inquiry Snapshot",
    responses={
        200: {"description": "Snapshot retrieved successfully"},
        403: {"description": "Insufficient permissions"},
        404: {"description": "Project not found or no snapshot available"}
    }
)
async def get_inquiry_snapshot(
    project_id: str,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Get latest inquiry space snapshot."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    if not await check_project_member_permission(current_user, project):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission")

    try:
        snapshot_data = await inquiry_service.load_latest_snapshot(project_id)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    if not snapshot_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No snapshot found")

    return {
        "project_id": project_id,
        "data": base64.b64encode(snapshot_data).decode("utf-8"),
    }

@router.post(
    "/projects/{project_id}/snapshot",
    summary="Save Inquiry Snapshot",
)
async def save_inquiry_snapshot(
    project_id: str,
    request: SnapshotRequest,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Save inquiry space snapshot."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    user_role = get_user_role_in_project_sync(current_user, project)
    if not can_edit_collaboration(user_role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only editors can save")

    try:
        binary_data = base64.b64decode(request.data)
    except Exception:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid base64")

    snapshot_id = await inquiry_service.save_snapshot(project_id, binary_data)

    await activity_service.log_activity(
        project_id=project_id,
        user_id=str(current_user.id),
        module="inquiry",
        action="save",
        target_id=project_id
    )

    return {"message": "Saved", "snapshot_id": snapshot_id}
