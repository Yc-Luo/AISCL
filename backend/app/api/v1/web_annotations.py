"""Web annotation API routes."""

import hashlib
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.v1.auth import get_current_user
from app.core.permissions import check_project_permission
from app.repositories.project import Project
from app.repositories.user import User
from app.repositories.web_annotation import WebAnnotation
from app.core.schemas.web_annotation import (
    WebAnnotationCreateRequest,
    WebAnnotationListResponse,
    WebAnnotationResponse,
    WebAnnotationUpdateRequest,
    WebScrapeRequest,
    WebScrapeResponse,
)
from app.services.web_scraper import web_scraper_service

router = APIRouter(prefix="/web-annotations", tags=["web-annotations"])


@router.post("/scrape", response_model=WebScrapeResponse)
async def scrape_webpage(
    scrape_data: WebScrapeRequest,
    current_user: User = Depends(get_current_user),
) -> WebScrapeResponse:
    """Scrape and extract content from a webpage."""
    # Scrape content
    result = await web_scraper_service.scrape_content(scrape_data.url)

    return WebScrapeResponse(
        url=result["url"],
        url_hash=result["url_hash"],
        title=result["title"],
        content=result["content"],
        cleaned_html=result["cleaned_html"],
    )


@router.get("", response_model=WebAnnotationListResponse)
async def list_web_annotations(
    project_id: Optional[str] = None,
    url: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    current_user: User = Depends(get_current_user),
) -> WebAnnotationListResponse:
    """List web annotations (filtered by project or current user)."""
    query = {}
    
    # Filter by project if provided, otherwise filter by user's projects? 
    # Or just return annotations created by user if no project specified?
    # For now, if project_id is provided, check access.
    if project_id:
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
        query["project_id"] = project_id
    else:
        # If no project_id, maybe list all annotations for user?
        # Or require project_id? 
        # The frontend error shows: GET http://localhost:8000/api/v1/web-annotations?skip=0&limit=100
        # It doesn't seem to pass project_id in query (it might be expecting user's annotations).
        query["author_id"] = str(current_user.id)

    if url:
        url_hash = hashlib.md5(url.encode()).hexdigest()
        query["url_hash"] = url_hash

    # Get annotations
    annotations = (
        await WebAnnotation.find(query)
        .skip(skip)
        .limit(limit)
        .sort("-created_at")
        .to_list()
    )
    total = await WebAnnotation.find(query).count()

    return WebAnnotationListResponse(
        annotations=[
            WebAnnotationResponse(
                id=str(a.id),
                project_id=a.project_id,
                url_hash=a.url_hash,
                target_url=a.target_url,
                selector=a.selector,
                annotation_type=a.annotation_type,
                color=a.color,
                content=a.content,
                author_id=a.author_id,
                created_at=a.created_at,
                updated_at=a.updated_at,
            )
            for a in annotations
        ],
        total=total,
    )


@router.get("/projects/{project_id}", response_model=WebAnnotationListResponse)
async def get_web_annotations(
    project_id: str,
    url: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    current_user: User = Depends(get_current_user),
) -> WebAnnotationListResponse:
    """Get web annotations for a project."""
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
    if url:
        url_hash = hashlib.md5(url.encode()).hexdigest()
        query["url_hash"] = url_hash

    # Get annotations
    annotations = (
        await WebAnnotation.find(query)
        .skip(skip)
        .limit(limit)
        .sort("-created_at")
        .to_list()
    )
    total = await WebAnnotation.find(query).count()

    return WebAnnotationListResponse(
        annotations=[
            WebAnnotationResponse(
                id=str(a.id),
                project_id=a.project_id,
                url_hash=a.url_hash,
                target_url=a.target_url,
                selector=a.selector,
                annotation_type=a.annotation_type,
                color=a.color,
                content=a.content,
                author_id=a.author_id,
                created_at=a.created_at,
                updated_at=a.updated_at,
            )
            for a in annotations
        ],
        total=total,
    )


@router.post(
    "/projects/{project_id}",
    response_model=WebAnnotationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_web_annotation(
    project_id: str,
    annotation_data: WebAnnotationCreateRequest,
    current_user: User = Depends(get_current_user),
) -> WebAnnotationResponse:
    """Create a web annotation."""
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
                detail="You don't have permission to annotate in this project",
            )

    # Generate URL hash
    url_hash = hashlib.md5(annotation_data.target_url.encode()).hexdigest()

    # Create annotation
    from datetime import datetime

    annotation = WebAnnotation(
        project_id=project_id,
        url_hash=url_hash,
        target_url=annotation_data.target_url,
        selector=annotation_data.selector,
        annotation_type=annotation_data.annotation_type,
        color=annotation_data.color,
        content=annotation_data.content,
        author_id=str(current_user.id),
    )
    await annotation.insert()

    return WebAnnotationResponse(
        id=str(annotation.id),
        project_id=annotation.project_id,
        url_hash=annotation.url_hash,
        target_url=annotation.target_url,
        selector=annotation.selector,
        annotation_type=annotation.annotation_type,
        color=annotation.color,
        content=annotation.content,
        author_id=annotation.author_id,
        created_at=annotation.created_at,
        updated_at=annotation.updated_at,
    )


@router.put("/{annotation_id}", response_model=WebAnnotationResponse)
async def update_web_annotation(
    annotation_id: str,
    annotation_data: WebAnnotationUpdateRequest,
    current_user: User = Depends(get_current_user),
) -> WebAnnotationResponse:
    """Update a web annotation."""
    annotation = await WebAnnotation.get(annotation_id)
    if not annotation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Annotation not found",
        )

    # Check permission (only author can update)
    if str(current_user.id) != annotation.author_id and current_user.role not in [
        "admin",
        "teacher",
    ]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only annotation author can update annotation",
        )

    # Update annotation
    from datetime import datetime

    if annotation_data.color is not None:
        annotation.color = annotation_data.color
    if annotation_data.content is not None:
        annotation.content = annotation_data.content
    annotation.updated_at = datetime.utcnow()
    await annotation.save()

    return WebAnnotationResponse(
        id=str(annotation.id),
        project_id=annotation.project_id,
        url_hash=annotation.url_hash,
        target_url=annotation.target_url,
        selector=annotation.selector,
        annotation_type=annotation.annotation_type,
        color=annotation.color,
        content=annotation.content,
        author_id=annotation.author_id,
        created_at=annotation.created_at,
        updated_at=annotation.updated_at,
    )


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_web_annotation(
    annotation_id: str,
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete a web annotation."""
    annotation = await WebAnnotation.get(annotation_id)
    if not annotation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Annotation not found",
        )

    # Check permission (only author can delete)
    if str(current_user.id) != annotation.author_id and current_user.role not in [
        "admin",
        "teacher",
    ]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only annotation author can delete annotation",
        )

    await annotation.delete()

