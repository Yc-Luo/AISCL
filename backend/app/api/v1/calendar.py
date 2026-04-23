"""Calendar event management API routes."""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.v1.auth import get_current_user
from app.core.permissions import check_project_permission
from app.repositories.calendar_event import CalendarEvent
from app.repositories.project import Project
from app.repositories.user import User
from app.core.schemas.calendar import (
    CalendarEventCreateRequest,
    CalendarEventListResponse,
    CalendarEventResponse,
    CalendarEventUpdateRequest,
)

router = APIRouter(prefix="/calendar", tags=["calendar"])


@router.get("/projects/{project_id}", response_model=CalendarEventListResponse)
async def get_calendar_events(
    project_id: str,
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    current_user: User = Depends(get_current_user),
) -> CalendarEventListResponse:
    """Get project calendar events."""
    # Check project access
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Build query
    query = {"project_id": project_id}

    # Filter by date range
    if start_date or end_date:
        date_query = {}
        if start_date:
            date_query["$gte"] = start_date
        if end_date:
            date_query["$lte"] = end_date
        query["start_time"] = date_query

    # Filter private events (Teacher can see all, others can't see private)
    if current_user.role not in ["teacher", "admin"]:
        query["$or"] = [
            {"is_private": False},
            {"created_by": str(current_user.id)},
        ]

    events = await CalendarEvent.find(query).sort("start_time").to_list()

    return CalendarEventListResponse(
        events=[
            CalendarEventResponse(
                id=str(e.id),
                project_id=e.project_id,
                title=e.title,
                start_time=e.start_time.isoformat(),
                end_time=e.end_time.isoformat(),
                type=e.type,
                created_by=e.created_by,
                is_private=e.is_private,
                created_at=e.created_at.isoformat(),
            )
            for e in events
        ]
    )


@router.post("/projects/{project_id}", response_model=CalendarEventResponse, status_code=status.HTTP_201_CREATED)
async def create_calendar_event(
    project_id: str,
    event_data: CalendarEventCreateRequest,
    current_user: User = Depends(get_current_user),
) -> CalendarEventResponse:
    """Create a new calendar event."""
    # Check project access
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Create event
    new_event = CalendarEvent(
        project_id=project_id,
        title=event_data.title,
        start_time=event_data.start_time,
        end_time=event_data.end_time,
        type=event_data.type,
        created_by=str(current_user.id),
        is_private=event_data.is_private or False,
    )
    await new_event.insert()

    return CalendarEventResponse(
        id=str(new_event.id),
        project_id=new_event.project_id,
        title=new_event.title,
        start_time=new_event.start_time.isoformat(),
        end_time=new_event.end_time.isoformat(),
        type=new_event.type,
        created_by=new_event.created_by,
        is_private=new_event.is_private,
        created_at=new_event.created_at.isoformat(),
    )


@router.put("/{event_id}", response_model=CalendarEventResponse)
async def update_calendar_event(
    event_id: str,
    event_data: CalendarEventUpdateRequest,
    current_user: User = Depends(get_current_user),
) -> CalendarEventResponse:
    """Update a calendar event."""
    event = await CalendarEvent.get(event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found",
        )

    # Check permission (creator or project owner/admin)
    project = await Project.get(event.project_id)
    is_creator = str(current_user.id) == event.created_by
    is_owner = project and str(current_user.id) == project.owner_id

    if not (is_creator or is_owner) and current_user.role not in ["admin", "teacher"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only event creator or project owner can update event",
        )

    if event_data.title:
        event.title = event_data.title
    if event_data.start_time:
        event.start_time = event_data.start_time
    if event_data.end_time:
        event.end_time = event_data.end_time
    if event_data.is_private is not None:
        event.is_private = event_data.is_private

    await event.save()

    return CalendarEventResponse(
        id=str(event.id),
        project_id=event.project_id,
        title=event.title,
        start_time=event.start_time.isoformat(),
        end_time=event.end_time.isoformat(),
        type=event.type,
        created_by=event.created_by,
        is_private=event.is_private,
        created_at=event.created_at.isoformat(),
    )


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_calendar_event(
    event_id: str,
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete a calendar event."""
    event = await CalendarEvent.get(event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found",
        )

    # Check permission
    project = await Project.get(event.project_id)
    is_creator = str(current_user.id) == event.created_by
    is_owner = project and str(current_user.id) == project.owner_id

    if not (is_creator or is_owner) and current_user.role not in ["admin", "teacher"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only event creator or project owner can delete event",
        )

    await event.delete()

