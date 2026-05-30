"""Admin APIs for research data management and export."""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.api.v1.auth import get_current_user
from app.core.datetime_utils import utc_isoformat
from app.core.db.mongodb import mongodb
from app.repositories.activity_log import ActivityLog
from app.repositories.ai_conversation import AIConversation
from app.repositories.ai_message import AIMessage
from app.repositories.chat_log import ChatLog
from app.repositories.document import Document
from app.repositories.project import Project
from app.repositories.research_event import ResearchEvent
from app.repositories.resource import Resource
from app.repositories.system_config import SystemConfig
from app.repositories.user import User

router = APIRouter(prefix="/admin/data", tags=["admin-data"])


class RetentionCleanupRequest(BaseModel):
    """Retention cleanup request."""

    collections: List[str]
    older_than_days: int
    confirm_operational_only: bool = True


class ConfigRestoreRequest(BaseModel):
    """System configuration restore request."""

    configs: List[Dict[str, Any]]


async def _require_admin(current_user: User) -> None:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")


async def _project_name_map(project_ids: List[str]) -> Dict[str, str]:
    projects = await Project.find({"_id": {"$in": project_ids}}).to_list()
    return {str(project.id): project.name for project in projects}


@router.get("/storage/overview")
async def get_storage_overview(
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return storage and research data overview from real collections."""
    await _require_admin(current_user)
    db = mongodb.get_database()
    resources = await Resource.find_all().to_list()
    total_size = sum(resource.size for resource in resources)

    by_type: Dict[str, Dict[str, Any]] = {}
    by_scope: Dict[str, Dict[str, Any]] = {}
    for resource in resources:
        by_type.setdefault(resource.mime_type, {"count": 0, "size": 0})
        by_type[resource.mime_type]["count"] += 1
        by_type[resource.mime_type]["size"] += resource.size
        by_scope.setdefault(resource.scope, {"count": 0, "size": 0})
        by_scope[resource.scope]["count"] += 1
        by_scope[resource.scope]["size"] += resource.size

    behavior_count = await db["behavior_stream"].count_documents({})
    heartbeat_count = await db["heartbeat_stream"].count_documents({})

    return {
        "resource_count": len(resources),
        "total_resource_size": total_size,
        "by_type": by_type,
        "by_scope": by_scope,
        "project_count": await Project.count(),
        "archived_project_count": await Project.find(Project.is_archived == True).count(),
        "research_event_count": await ResearchEvent.count(),
        "activity_log_count": await ActivityLog.count(),
        "group_chat_count": await ChatLog.count(),
        "ai_conversation_count": await AIConversation.count(),
        "ai_message_count": await AIMessage.count(),
        "document_count": await Document.count(),
        "behavior_stream_count": behavior_count,
        "heartbeat_stream_count": heartbeat_count,
    }


@router.get("/storage/by-project")
async def get_storage_by_project(
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return project-level storage ranking."""
    await _require_admin(current_user)
    resources = await Resource.find_all().to_list()
    grouped: Dict[str, Dict[str, Any]] = {}
    for resource in resources:
        project_id = resource.project_id or "(course-resource)"
        grouped.setdefault(project_id, {"project_id": project_id, "file_count": 0, "total_size": 0})
        grouped[project_id]["file_count"] += 1
        grouped[project_id]["total_size"] += resource.size

    project_names = await _project_name_map([project_id for project_id in grouped if project_id != "(course-resource)"])
    rows = sorted(grouped.values(), key=lambda item: item["total_size"], reverse=True)[:limit]
    for row in rows:
        row["project_name"] = project_names.get(row["project_id"], "课程资源" if row["project_id"] == "(course-resource)" else "未知项目")
    return {"items": rows, "total": len(grouped)}


@router.get("/retention/preview")
async def preview_retention_cleanup(
    older_than_days: int = Query(90, ge=1, le=3650),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Preview cleanup candidates. Research-core data is reported but protected."""
    await _require_admin(current_user)
    db = mongodb.get_database()
    cutoff = datetime.utcnow() - timedelta(days=older_than_days)
    operational = {
        "behavior_stream": await db["behavior_stream"].count_documents({"timestamp": {"$lt": cutoff}}),
        "heartbeat_stream": await db["heartbeat_stream"].count_documents({"timestamp": {"$lt": cutoff}}),
        "activity_logs": await ActivityLog.find(ActivityLog.timestamp < cutoff).count(),
    }
    protected = {
        "chat_logs": await ChatLog.find(ChatLog.created_at < cutoff).count(),
        "research_events": await ResearchEvent.find(ResearchEvent.event_time < cutoff).count(),
        "documents": await Document.find(Document.created_at < cutoff).count(),
        "ai_messages": await AIMessage.find(AIMessage.created_at < cutoff).count(),
    }
    return {
        "older_than_days": older_than_days,
        "cutoff": cutoff,
        "operational_cleanup_candidates": operational,
        "protected_research_data": protected,
        "note": "清理接口默认只允许删除运维数据；研究核心数据仅统计，不会被一键清理。",
    }


@router.post("/retention/cleanup")
async def run_retention_cleanup(
    data: RetentionCleanupRequest,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Clean only operational data collections."""
    await _require_admin(current_user)
    if not data.confirm_operational_only:
        raise HTTPException(status_code=400, detail="Only operational cleanup is supported by this endpoint")

    allowed = {"behavior_stream", "heartbeat_stream", "activity_logs"}
    requested = set(data.collections)
    blocked = requested - allowed
    if blocked:
        raise HTTPException(status_code=400, detail=f"Protected collections cannot be cleaned here: {sorted(blocked)}")

    db = mongodb.get_database()
    cutoff = datetime.utcnow() - timedelta(days=data.older_than_days)
    deleted: Dict[str, int] = {}
    if "behavior_stream" in requested:
        result = await db["behavior_stream"].delete_many({"timestamp": {"$lt": cutoff}})
        deleted["behavior_stream"] = result.deleted_count
    if "heartbeat_stream" in requested:
        result = await db["heartbeat_stream"].delete_many({"timestamp": {"$lt": cutoff}})
        deleted["heartbeat_stream"] = result.deleted_count
    if "activity_logs" in requested:
        result = await ActivityLog.find(ActivityLog.timestamp < cutoff).delete()
        deleted["activity_logs"] = result.deleted_count
    return {"deleted": deleted, "cutoff": cutoff}


@router.get("/projects")
async def list_data_projects(
    archived: Optional[bool] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """List projects for archive and export management."""
    await _require_admin(current_user)
    query: Dict[str, Any] = {}
    if archived is not None:
        query["is_archived"] = archived
    if search:
        query["name"] = {"$regex": search, "$options": "i"}
    projects = await Project.find(query).skip((page - 1) * limit).limit(limit).sort("-updated_at").to_list()
    total = await Project.find(query).count()
    return {
        "items": [
            {
                "id": str(project.id),
                "name": project.name,
                "course_id": project.course_id,
                "owner_id": project.owner_id,
                "leader_id": project.leader_id,
                "member_count": len(project.members or []),
                "is_archived": project.is_archived,
                "created_at": project.created_at,
                "updated_at": project.updated_at,
            }
            for project in projects
        ],
        "total": total,
    }


@router.post("/projects/{project_id}/archive")
async def archive_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Archive one project."""
    await _require_admin(current_user)
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.is_archived = True
    project.updated_at = datetime.utcnow()
    await project.save()
    return {"id": str(project.id), "is_archived": project.is_archived}


@router.post("/projects/{project_id}/unarchive")
async def unarchive_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Unarchive one project."""
    await _require_admin(current_user)
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.is_archived = False
    project.updated_at = datetime.utcnow()
    await project.save()
    return {"id": str(project.id), "is_archived": project.is_archived}


@router.post("/export")
async def export_research_data(
    project_id: Optional[str] = None,
    format: str = Query("json", pattern="^(json|csv)$"),
    current_user: User = Depends(get_current_user),
):
    """Export core research data for one project or all projects."""
    await _require_admin(current_user)
    query = {"project_id": project_id} if project_id else {}
    chat_logs = await ChatLog.find(query).sort("created_at").to_list()
    research_events = await ResearchEvent.find(query).sort("event_time").to_list()
    activity_logs = await ActivityLog.find(query).sort("timestamp").to_list()

    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["source", "id", "project_id", "user_id", "type", "content", "timestamp"])
        for item in chat_logs:
            writer.writerow(["chat", str(item.id), item.project_id, item.user_id, item.message_type, item.content, utc_isoformat(item.created_at)])
        for item in research_events:
            writer.writerow(["research_event", str(item.id), item.project_id, item.user_id or "", item.event_type, json.dumps(item.payload, ensure_ascii=False), utc_isoformat(item.event_time)])
        for item in activity_logs:
            writer.writerow(["activity_log", str(item.id), item.project_id, item.user_id, item.action, json.dumps(item.metadata or {}, ensure_ascii=False), utc_isoformat(item.timestamp)])
        output.seek(0)
        filename = f"aiscl_research_export_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
        return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename={filename}"})

    return {
        "project_id": project_id,
        "chat_logs": [item.model_dump(mode="json") | {"id": str(item.id)} for item in chat_logs],
        "research_events": [item.model_dump(mode="json") | {"id": str(item.id)} for item in research_events],
        "activity_logs": [item.model_dump(mode="json") | {"id": str(item.id)} for item in activity_logs],
    }


@router.get("/backup/config")
async def export_system_configs(
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Export SystemConfig records as JSON."""
    await _require_admin(current_user)
    configs = await SystemConfig.find_all().to_list()
    return {
        "exported_at": datetime.utcnow(),
        "configs": [
            {
                "key": config.key,
                "value": config.value,
                "description": config.description,
                "updated_by": config.updated_by,
                "updated_at": config.updated_at,
            }
            for config in configs
        ],
    }


@router.post("/backup/config/restore")
async def restore_system_configs(
    data: ConfigRestoreRequest,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Restore SystemConfig records from an exported JSON payload."""
    await _require_admin(current_user)
    restored = 0
    for item in data.configs:
        key = str(item.get("key") or "").strip()
        if not key:
            continue
        config = await SystemConfig.find_one(SystemConfig.key == key)
        if not config:
            config = SystemConfig(
                key=key,
                value=str(item.get("value") or ""),
                description=item.get("description"),
                updated_by=str(current_user.id),
            )
            await config.insert()
        else:
            config.value = str(item.get("value") or "")
            config.description = item.get("description")
            config.updated_by = str(current_user.id)
            config.updated_at = datetime.utcnow()
            await config.save()
        restored += 1
    return {"restored": restored}
