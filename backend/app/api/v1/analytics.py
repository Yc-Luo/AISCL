"""Analytics API routes for behavior tracking and heartbeats."""

import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status

from app.api.v1.auth import get_current_user
from app.core.permissions import can_manage_project_scope, check_project_member_permission
from app.repositories.user import User
from app.core.schemas.analytics import (
    BehaviorDataBatchRequest,
    BehaviorDataRequest,
    HeartbeatRequest,
    SuccessResponse,
)
from app.core.schemas.research_events import (
    GroupStageFeatureListResponse,
    GroupStageFeatureRow,
    AITutorTranscriptListResponse,
    AITutorTranscriptRow,
    GroupChatTranscriptListResponse,
    GroupChatTranscriptRow,
    LSAReadyEventListResponse,
    LSAReadyEventRow,
    ResearchEventBatchRequest,
    ResearchEventListResponse,
    ResearchProjectHealthResponse,
    ResearchEventResponse,
)
from app.repositories.project import Project
from app.services.activity_service import activity_service
from app.services.research_event_service import research_event_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics", tags=["analytics"])


async def ensure_project_access(current_user: User, project: Project) -> None:
    """Ensure current user can access project."""
    if not await check_project_member_permission(current_user, project):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to access this project",
        )


async def ensure_project_id_access(current_user: User, project_id: str) -> None:
    """Load a project by id and ensure current user can write/read its analytics."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    await ensure_project_access(current_user, project)


async def ensure_project_export_access(current_user: User, project: Project) -> None:
    """Ensure current user can export project-level research artifacts."""
    if current_user.role == "admin":
        return
    if current_user.role == "teacher" and await can_manage_project_scope(current_user, project):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Only admin and scoped teacher can export project research data",
    )


async def log_behaviors_to_stream(obs: list):
    """Log behaviors to Time Series stream in background."""
    try:
        from app.core.db.mongodb import mongodb
        db = mongodb.get_database()
        stream_data = [
            {
                "timestamp": b.get("timestamp") or datetime.utcnow(),
                "metadata": {
                    "project_id": b.get("project_id"),
                    "user_id": b.get("user_id"),
                    "module": b.get("module"),
                    "action": b.get("action"),
                }
            } for b in obs
        ]
        if stream_data:
            await db["behavior_stream"].insert_many(stream_data)
    except Exception as e:
        logger.error(f"Error logging behaviors to stream: {e}", exc_info=True)


async def log_heartbeat_to_stream(hb_data_dict: dict):
    """Log heartbeat to Time Series stream in background."""
    try:
        from app.core.db.mongodb import mongodb
        db = mongodb.get_database()
        await db["heartbeat_stream"].insert_one({
            "timestamp": datetime.utcnow(),
            "metadata": {
                "project_id": hb_data_dict.get("project_id"),
                "user_id": hb_data_dict.get("user_id"),
                "module": hb_data_dict.get("module"),
                "resource_id": hb_data_dict.get("resource_id"),
            }
        })
    except Exception as e:
        logger.error(f"Error logging heartbeat to stream: {e}", exc_info=True)


@router.post("/behavior", response_model=SuccessResponse)
async def receive_behavior_data(
    behavior_data: BehaviorDataRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
) -> SuccessResponse:
    """Receive behavior data from frontend (single entry)."""
    # Validate project_id and user_id
    if behavior_data.user_id != str(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User ID mismatch",
        )
    await ensure_project_id_access(current_user, behavior_data.project_id)

    # Queue for async processing
    background_tasks.add_task(
        activity_service.log_activity,
        project_id=behavior_data.project_id,
        user_id=behavior_data.user_id,
        module=behavior_data.module,
        action=behavior_data.action,
        duration=behavior_data.metadata.get("duration", 0) if behavior_data.metadata else 0,
        target_id=behavior_data.metadata.get("resource_id") if behavior_data.metadata else None,
        metadata=behavior_data.metadata,
    )

    return SuccessResponse(message="Behavior data received")


@router.post("/behavior/batch", response_model=SuccessResponse)
async def receive_behavior_data_batch(
    batch_data: BehaviorDataBatchRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
) -> SuccessResponse:
    """Receive behavior data in batch (up to 100 entries)."""
    if len(batch_data.behaviors) > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Batch size exceeds maximum of 100",
        )

    # Validate all entries belong to current user
    for behavior in batch_data.behaviors:
        if behavior.user_id != str(current_user.id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User ID mismatch in batch data",
            )
    for project_id in {behavior.project_id for behavior in batch_data.behaviors}:
        await ensure_project_id_access(current_user, project_id)

    # Prepare activities for batch insert
    activities = []
    for behavior in batch_data.behaviors:
        activities.append({
            "project_id": behavior.project_id,
            "user_id": behavior.user_id,
            "module": behavior.module,
            "action": behavior.action,
            "target_id": behavior.metadata.get("resource_id") if behavior.metadata else None,
            "duration": behavior.metadata.get("duration", 0) if behavior.metadata else 0,
            "metadata": behavior.metadata,
            "timestamp": behavior.timestamp or datetime.utcnow(),
        })

    # Promote 'content modification' behaviors to business dynamics (activity_logs)
    modification_actions = ["edit", "comment", "create", "update", "delete", "upload", "send"]
    activities_to_promote = [
        a for a in activities 
        if any(token in a["action"] for token in modification_actions)
    ]

    background_tasks.add_task(log_behaviors_to_stream, activities)
    if activities_to_promote:
        background_tasks.add_task(activity_service.log_batch_activities, activities_to_promote)

    return SuccessResponse(message=f"Batch behavior data received: {len(activities)} entries")


@router.post("/research-events/batch", response_model=SuccessResponse)
async def receive_research_events_batch(
    batch_data: ResearchEventBatchRequest,
    current_user: User = Depends(get_current_user),
) -> SuccessResponse:
    """Receive research-mode events in batch."""
    if len(batch_data.events) > 200:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Batch size exceeds maximum of 200",
        )

    current_user_id = str(current_user.id)
    for event in batch_data.events:
        if event.user_id and event.user_id != current_user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User ID mismatch in research event batch",
            )
    for project_id in {event.project_id for event in batch_data.events}:
        await ensure_project_id_access(current_user, project_id)

    count = await research_event_service.record_batch_events(
        [event.model_dump() for event in batch_data.events],
        current_user_id=current_user_id,
    )
    return SuccessResponse(message=f"Research events received: {count} entries")


@router.post("/heartbeat", response_model=SuccessResponse)
async def receive_heartbeat(
    heartbeat_data: HeartbeatRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
) -> SuccessResponse:
    """Receive heartbeat data from frontend (every 30 seconds)."""
    # Validate project_id and user_id
    if heartbeat_data.user_id != str(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User ID mismatch",
        )
    await ensure_project_id_access(current_user, heartbeat_data.project_id)

    background_tasks.add_task(log_heartbeat_to_stream, heartbeat_data.model_dump())

    return SuccessResponse(message="Heartbeat received")


@router.get("/projects/{project_id}/research-events", response_model=ResearchEventListResponse)
async def get_research_events(
    project_id: str,
    skip: int = 0,
    limit: int = 100,
    event_domain: Optional[str] = None,
    group_id: Optional[str] = None,
    stage_id: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    current_user: User = Depends(get_current_user),
) -> ResearchEventListResponse:
    """Get research events for a project."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_export_access(current_user, project)
    events, total = await research_event_service.get_events_by_project(
        project_id=project_id,
        skip=skip,
        limit=limit,
        event_domain=event_domain,
        group_id=group_id,
        stage_id=stage_id,
        start_date=start_date,
        end_date=end_date,
    )
    return ResearchEventListResponse(
        events=[
            ResearchEventResponse(
                id=str(event.id),
                project_id=event.project_id,
                experiment_version_id=event.experiment_version_id,
                room_id=event.room_id,
                group_id=event.group_id,
                user_id=event.user_id,
                actor_type=event.actor_type,
                event_domain=event.event_domain,
                event_type=event.event_type,
                event_time=event.event_time,
                stage_id=event.stage_id,
                sequence_index=event.sequence_index,
                payload=event.payload,
                created_at=event.created_at,
            )
            for event in events
        ],
        total=total,
    )


@router.get(
    "/projects/{project_id}/group-stage-features",
    response_model=GroupStageFeatureListResponse,
)
async def get_group_stage_features(
    project_id: str,
    experiment_version_id: Optional[str] = None,
    group_id: Optional[str] = None,
    stage_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
) -> GroupStageFeatureListResponse:
    """Export minimal group-stage aggregated features for downstream analysis."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_export_access(current_user, project)
    features = await research_event_service.export_group_stage_features(
        project_id=project_id,
        experiment_version_id=experiment_version_id,
        group_id=group_id,
        stage_id=stage_id,
    )
    return GroupStageFeatureListResponse(
        features=[GroupStageFeatureRow(**feature) for feature in features],
        total=len(features),
    )


@router.get(
    "/projects/{project_id}/lsa-ready",
    response_model=LSAReadyEventListResponse,
)
async def get_lsa_ready_sequences(
    project_id: str,
    experiment_version_id: Optional[str] = None,
    group_id: Optional[str] = None,
    stage_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
) -> LSAReadyEventListResponse:
    """Export time-ordered event sequences for LSA/HMM preparation."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_export_access(current_user, project)
    sequences = await research_event_service.export_lsa_ready_sequences(
        project_id=project_id,
        experiment_version_id=experiment_version_id,
        group_id=group_id,
        stage_id=stage_id,
    )
    return LSAReadyEventListResponse(
        sequences=[LSAReadyEventRow(**row) for row in sequences],
        total=len(sequences),
    )


@router.get(
    "/projects/{project_id}/group-chat-transcripts",
    response_model=GroupChatTranscriptListResponse,
)
async def get_group_chat_transcripts(
    project_id: str,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    limit: int = Query(20000, ge=1, le=50000),
    current_user: User = Depends(get_current_user),
) -> GroupChatTranscriptListResponse:
    """Export full group-chat transcripts for a project."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_export_access(current_user, project)
    result = await research_event_service.export_group_chat_transcripts(
        project_id=project_id,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
    )
    return GroupChatTranscriptListResponse(
        messages=[GroupChatTranscriptRow(**row) for row in result["messages"]],
        total=result["total"],
    )


@router.get(
    "/projects/{project_id}/ai-tutor-transcripts",
    response_model=AITutorTranscriptListResponse,
)
async def get_ai_tutor_transcripts(
    project_id: str,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    limit: int = Query(20000, ge=1, le=50000),
    current_user: User = Depends(get_current_user),
) -> AITutorTranscriptListResponse:
    """Export full AI tutor transcripts for a project."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_export_access(current_user, project)
    result = await research_event_service.export_ai_tutor_transcripts(
        project_id=project_id,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
    )
    return AITutorTranscriptListResponse(
        messages=[AITutorTranscriptRow(**row) for row in result["messages"]],
        total=result["total"],
    )


@router.get(
    "/projects/{project_id}/research-health",
    response_model=ResearchProjectHealthResponse,
)
async def get_research_project_health(
    project_id: str,
    current_user: User = Depends(get_current_user),
) -> ResearchProjectHealthResponse:
    """Get a minimal health snapshot for one project's research-mode data."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_export_access(current_user, project)
    snapshot = await research_event_service.get_project_health_snapshot(project_id)
    return ResearchProjectHealthResponse(**snapshot)


@router.get("/projects/{project_id}/activity-logs")
async def get_activity_logs(
    project_id: str,
    skip: int = 0,
    limit: int = 100,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Get activity logs for a project."""
    # Check project access
    from app.repositories.activity_log import ActivityLog

    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_export_access(current_user, project)

    query = {"project_id": project_id}
    if start_date:
        query["timestamp"] = {"$gte": start_date}
    if end_date:
        if "timestamp" in query:
            query["timestamp"]["$lte"] = end_date
        else:
            query["timestamp"] = {"$lte": end_date}

    logs = (
        await ActivityLog.find(query)
        .skip(skip)
        .limit(limit)
        .sort("-timestamp")
        .to_list()
    )
    total = await ActivityLog.find(query).count()

    return {
        "logs": [
            {
                "id": str(log.id),
                "project_id": log.project_id,
                "user_id": log.user_id,
                "module": log.module,
                "action": log.action,
                "target_id": log.target_id,
                "duration": log.duration,
                "timestamp": log.timestamp,
            }
            for log in logs
        ],
        "total": total,
    }


@router.get("/projects/{project_id}/dashboard")
async def get_dashboard_data(
    project_id: str,
    background_tasks: BackgroundTasks,
    user_id: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Get dashboard data for a project (cached, updated every 30m)."""
    from app.services.analytics_service import analytics_service

    # Check project access
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_access(current_user, project)

    # Use current user if user_id not specified
    target_user_id = user_id or str(current_user.id)
    if target_user_id != str(current_user.id):
        await ensure_project_export_access(current_user, project)

    # Fetch cached dashboard data (pre-updated every 30 mins)
    dashboard_data = await analytics_service.get_cached_dashboard_data(
        project_id, background_tasks=background_tasks, user_id=target_user_id
    )
    
    if not dashboard_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dashboard data not available",
        )

    # Add project metadata for response consistency
    dashboard_data.update({
        "project_id": project_id,
        "user_id": target_user_id
    })

    return dashboard_data


@router.get("/projects/{project_id}/behavior")
async def get_behavior_stream(
    project_id: str,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Get behavior stream data for a project."""
    from app.repositories.project import Project
    from motor.motor_asyncio import AsyncIOMotorClient
    from app.core.config import settings

    # Check project access
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_export_access(current_user, project)

    # Query behavior_stream Time Series Collection
    client = AsyncIOMotorClient(settings.MONGODB_URI)
    db = client[settings.MONGODB_DB_NAME]
    behavior_collection = db["behavior_stream"]

    query = {"metadata.project_id": project_id}
    if start_date:
        query["timestamp"] = {"$gte": start_date}
    if end_date:
        if "timestamp" in query:
            query["timestamp"]["$lte"] = end_date
        else:
            query["timestamp"] = {"$lte": end_date}

    behaviors = (
        await behavior_collection.find(query)
        .sort("timestamp", -1)
        .limit(1000)
        .to_list(length=1000)
    )

    client.close()

    return {
        "behaviors": [
            {
                "timestamp": b.get("timestamp"),
                "module": b.get("metadata", {}).get("module"),
                "action": b.get("metadata", {}).get("action"),
                "user_id": b.get("metadata", {}).get("user_id"),
            }
            for b in behaviors
        ],
        "total": len(behaviors),
    }


@router.get("/projects/{project_id}/export")
async def export_analytics_data(
    project_id: str,
    format: str = "json",
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Export analytics data for a project."""
    from app.repositories.project import Project

    # Check project access
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_export_access(current_user, project)

    # Get dashboard data
    dashboard_data = await get_dashboard_data(
        project_id=project_id,
        background_tasks=BackgroundTasks(),
        user_id=None,
        start_date=start_date,
        end_date=end_date,
        current_user=current_user,
    )

    # Get activity logs
    activity_logs = await get_activity_logs(
        project_id, 0, 10000, start_date, end_date, current_user
    )

    # Get behavior stream
    behavior_stream = await get_behavior_stream(
        project_id, start_date, end_date, current_user
    )

    return {
        "project_id": project_id,
        "exported_at": datetime.utcnow().isoformat(),
        "format": format,
        "data": {
            "dashboard": dashboard_data,
            "activity_logs": activity_logs,
            "behavior_stream": behavior_stream,
        },
    }
