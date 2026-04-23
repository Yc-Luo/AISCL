"""Collaboration API routes."""

from fastapi import APIRouter, Depends, Query
from typing import Dict, Any

from app.api.v1.auth import get_current_user
from app.repositories.user import User
from app.repositories.collaboration_snapshot import CollaborationSnapshot
from app.core.schemas.analytics import SuccessResponse

router = APIRouter(prefix="/collaboration", tags=["collaboration"])

@router.get("/projects/{project_id}/snapshot")
async def get_snapshot(
    project_id: str,
    type: str = Query("whiteboard", description="Type of snapshot: whiteboard, document, inquiry"),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Get the latest snapshot for a project/resource."""
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
    snapshot = CollaborationSnapshot(
        project_id=project_id,
        snapshot_data=snapshot_data
    )
    await snapshot.save()
    
    return SuccessResponse(message="Snapshot saved successfully")
