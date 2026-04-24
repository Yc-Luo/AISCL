"""Project Wiki API routes."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.v1.auth import get_current_user
from app.core.permissions import check_project_member_permission
from app.core.schemas.wiki import (
    WikiItemCreateRequest,
    WikiItemListResponse,
    WikiItemResponse,
    WikiItemUpdateRequest,
    WikiSearchResponse,
)
from app.repositories.project import Project
from app.repositories.user import User
from app.repositories.wiki_item import WikiItem
from app.services.wiki_service import wiki_service

router = APIRouter(prefix="/wiki", tags=["wiki"])


async def _ensure_project_access(current_user: User, project: Project) -> None:
    """Ensure the current user can access a project."""
    if not await check_project_member_permission(current_user, project):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to access this project",
        )


async def _get_accessible_project(project_id: str, current_user: User) -> Project:
    """Get a project and check access."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    await _ensure_project_access(current_user, project)
    return project


def _to_response(item: WikiItem) -> WikiItemResponse:
    """Convert Wiki item document to response schema."""
    return WikiItemResponse(**wiki_service._to_response_dict(item))


@router.post("/items", response_model=WikiItemResponse, status_code=status.HTTP_201_CREATED)
async def create_wiki_item(
    item_data: WikiItemCreateRequest,
    current_user: User = Depends(get_current_user),
) -> WikiItemResponse:
    """Create a project Wiki item."""
    await _get_accessible_project(item_data.project_id, current_user)
    actor_type = "teacher" if current_user.role == "teacher" else "student"
    if current_user.role == "admin":
        actor_type = "system"

    item = await wiki_service.create_item(
        item_data.model_dump(),
        current_user_id=str(current_user.id),
        actor_type=actor_type,
    )
    return _to_response(item)


@router.get("/projects/{project_id}/items", response_model=WikiItemListResponse)
async def list_wiki_items(
    project_id: str,
    group_id: Optional[str] = None,
    item_type: Optional[str] = None,
    stage_id: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
) -> WikiItemListResponse:
    """List project Wiki items."""
    await _get_accessible_project(project_id, current_user)
    items, total = await wiki_service.list_items(
        project_id,
        group_id=group_id,
        item_type=item_type,
        stage_id=stage_id,
        skip=skip,
        limit=limit,
    )
    return WikiItemListResponse(
        items=[_to_response(item) for item in items],
        total=total,
    )


@router.get("/projects/{project_id}/search", response_model=WikiSearchResponse)
async def search_wiki_items(
    project_id: str,
    query: str = Query(..., min_length=1),
    group_id: Optional[str] = None,
    item_type: Optional[str] = None,
    stage_id: Optional[str] = None,
    limit: int = Query(5, ge=1, le=20),
    current_user: User = Depends(get_current_user),
) -> WikiSearchResponse:
    """Search project Wiki items."""
    await _get_accessible_project(project_id, current_user)
    results = await wiki_service.search_items(
        project_id,
        query,
        group_id=group_id,
        item_type=item_type,
        stage_id=stage_id,
        limit=limit,
    )
    return WikiSearchResponse(
        items=[WikiItemResponse(**{k: v for k, v in item.items() if k != "score"}) for item in results],
        total=len(results),
        query=query,
    )


@router.patch("/items/{item_id}", response_model=WikiItemResponse)
async def update_wiki_item(
    item_id: str,
    item_data: WikiItemUpdateRequest,
    current_user: User = Depends(get_current_user),
) -> WikiItemResponse:
    """Update a project Wiki item."""
    item = await WikiItem.get(item_id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Wiki item not found",
        )
    await _get_accessible_project(item.project_id, current_user)
    actor_type = "teacher" if current_user.role == "teacher" else "student"
    if current_user.role == "admin":
        actor_type = "system"

    updated_item = await wiki_service.update_item(
        item,
        item_data.model_dump(exclude_unset=True),
        current_user_id=str(current_user.id),
        actor_type=actor_type,
    )
    return _to_response(updated_item)
