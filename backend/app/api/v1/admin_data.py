"""Admin APIs for research data management and export."""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from bson import ObjectId
from starlette.background import BackgroundTask

from app.api.v1.auth import get_current_user
from app.core.datetime_utils import ensure_aware_utc, utc_isoformat
from app.core.db.mongodb import mongodb
from app.core.security import content_disposition_header
from app.repositories.activity_log import ActivityLog
from app.repositories.ai_conversation import AIConversation
from app.repositories.ai_message import AIMessage
from app.repositories.chat_log import ChatLog
from app.repositories.course import Course
from app.repositories.course_task_release import CourseTaskRelease
from app.repositories.document import Document
from app.repositories.inquiry_snapshot import InquirySnapshot
from app.repositories.project import Project
from app.repositories.research_event import ResearchEvent
from app.repositories.resource import Resource
from app.repositories.system_config import SystemConfig
from app.repositories.task import Task
from app.repositories.task_submission_artifact import TaskSubmissionArtifact
from app.repositories.user import User
from app.repositories.wiki_item import WikiItem
from app.services.storage_service import storage_service

router = APIRouter(prefix="/admin/data", tags=["admin-data"])
logger = logging.getLogger(__name__)


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


def _zip_safe_segment(value: Optional[str], fallback: str = "未命名") -> str:
    text = "".join(ch if ch.isalnum() or ch in "._- " else "_" for ch in str(value or fallback)).strip(". ")
    return text[:80] or fallback


def _remove_temp_file(path: str) -> None:
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass


def _stream_file(path: str, chunk_size: int = 1024 * 1024):
    with open(path, "rb") as file:
        while True:
            chunk = file.read(chunk_size)
            if not chunk:
                break
            yield chunk


def _write_csv(archive: zipfile.ZipFile, path: str, rows: List[Dict[str, Any]], fieldnames: List[str]) -> None:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: _csv_value(row.get(key)) for key in fieldnames})
    archive.writestr(path, output.getvalue().encode("utf-8-sig"))


def _csv_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return utc_isoformat(value)
    if isinstance(value, (dict, list, tuple, set)):
        return json.dumps(_json_safe(value), ensure_ascii=False)
    if isinstance(value, ObjectId):
        return str(value)
    if value is None:
        return ""
    return value


def _json_safe(value: Any) -> Any:
    if isinstance(value, datetime):
        return utc_isoformat(value)
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    if hasattr(value, "model_dump"):
        return _json_safe(value.model_dump(mode="json"))
    return value


def _datetime_or_none(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return ensure_aware_utc(value)
    if isinstance(value, str):
        try:
            return ensure_aware_utc(datetime.fromisoformat(value.replace("Z", "+00:00")))
        except ValueError:
            return None
    return None


def _safe_isoformat(value: Any) -> str:
    normalized = _datetime_or_none(value)
    if normalized:
        return utc_isoformat(normalized) or ""
    return str(value or "")


def _anonymize_user_id(user_id: Optional[str], user_code_map: Dict[str, str]) -> str:
    if not user_id:
        return ""
    return user_code_map.get(str(user_id), "external_or_system")


def _build_user_code_map(user_ids: set[str], users: List[User], course: Course) -> Dict[str, str]:
    """Build stable anonymous IDs that keep broad role information."""
    user_by_id = {str(user.id): user for user in users}
    teacher_ids = {str(course.teacher_id)}
    student_ids = {str(user_id) for user_id in course.students or []}
    assigned: Dict[str, str] = {}

    teacher_candidates = sorted(
        user_id
        for user_id in user_ids
        if user_id in teacher_ids or (user_by_id.get(user_id) and user_by_id[user_id].role == "teacher")
    )
    for index, user_id in enumerate(teacher_candidates, start=1):
        assigned[user_id] = f"T{index:03d}"

    student_candidates = sorted(
        user_id
        for user_id in user_ids
        if user_id not in assigned and (user_id in student_ids or (user_by_id.get(user_id) and user_by_id[user_id].role == "student"))
    )
    for index, user_id in enumerate(student_candidates, start=1):
        assigned[user_id] = f"S{index:03d}"

    other_candidates = sorted(user_id for user_id in user_ids if user_id not in assigned)
    for index, user_id in enumerate(other_candidates, start=1):
        assigned[user_id] = f"U{index:03d}"
    return assigned


def _behavior_codebook_rows() -> List[Dict[str, str]]:
    return [
        {"space": "chat", "action": "message_send", "analysis_use": "同伴对话、观点表达、情绪协调、协商推进", "interpretation_note": "需结合内容编码；单条发言不能直接推断高质量协作。"},
        {"space": "chat", "action": "teacher_help_request", "analysis_use": "学生主动求助、调节需求", "interpretation_note": "可分析求助前后的讨论/产物变化。"},
        {"space": "teacher_support", "action": "reply_or_guidance", "analysis_use": "教师低干预支持", "interpretation_note": "适合分析教师介入后的小组响应链。"},
        {"space": "ai", "action": "ai_response_or_auto_prompt", "analysis_use": "AI 支架介入", "interpretation_note": "重点看 AI 后 3-5 个学生行为是否出现补证据、追问、修订。"},
        {"space": "resource", "action": "upload_open_preview_download", "analysis_use": "资料获取与证据准备", "interpretation_note": "上传/打开只能说明接触资料，需与引用、发言、文档修改串联解释。"},
        {"space": "document", "action": "create_edit_comment_commit", "analysis_use": "共同产物建构", "interpretation_note": "编辑内容、批注、版本保存可作为成果推进证据。"},
        {"space": "inquiry", "action": "node_edge_snapshot", "analysis_use": "观点、证据、反驳关系结构化", "interpretation_note": "适合分析批判性思维和解释整合。"},
        {"space": "wiki", "action": "knowledge_item_create_update", "analysis_use": "知识沉淀与阶段性总结", "interpretation_note": "结合来源和可信度字段判断知识质量。"},
        {"space": "task", "action": "submit_supplement_archive", "analysis_use": "任务推进与成果提交", "interpretation_note": "提交后补充资料可视为成果修订，不应覆盖历史解释。"},
        {"space": "presence", "action": "sessionized_heartbeat", "analysis_use": "在线时段与共同在线机会", "interpretation_note": "心跳只表示在场，不等于有效参与；需聚合成 session 后使用。"},
    ]


def _data_dictionary_rows() -> List[Dict[str, str]]:
    return [
        {"file": "metadata/users_anonymized.csv", "field": "anonymous_id", "meaning": "匿名学习者/教师编号", "analysis_note": "用于替代真实 user_id。"},
        {"file": "cleaned/heartbeat_sessions.csv", "field": "session_id", "meaning": "由连续心跳合并生成的在线会话", "analysis_note": "默认间隔超过 180 秒切分新会话。"},
        {"file": "cleaned/heartbeat_sessions.csv", "field": "overlap_ready", "meaning": "是否可用于共同在线分析", "analysis_note": "同组成员 session 可进一步计算重叠时长。"},
        {"file": "raw/group_members.csv", "field": "project_role", "meaning": "小组内成员身份", "analysis_note": "用于解释组长/成员责任分工与行为差异。"},
        {"file": "analysis_ready/event_sequence.csv", "field": "previous_event_id", "meaning": "同一小组内前一事件", "analysis_note": "用于滞后序列、过程挖掘和行为链解释。"},
        {"file": "analysis_ready/event_sequence.csv", "field": "time_since_previous_seconds", "meaning": "与前一事件的时间间隔", "analysis_note": "过长间隔不宜解释为直接响应。"},
        {"file": "analysis_ready/event_sequence.csv", "field": "semantic_tags", "meaning": "由事件类型或元数据推断的初步标签", "analysis_note": "正式论文分析前建议抽样人工校验。"},
        {"file": "analysis_ready/event_sequence.csv", "field": "ai_related", "meaning": "是否与 AI 支架相关", "analysis_note": "用于比较 AI 介入前后行为链。"},
        {"file": "analysis_ready/event_sequence.csv", "field": "teacher_related", "meaning": "是否与教师介入相关", "analysis_note": "用于识别低干预支持。"},
        {"file": "analysis_ready/intervention_windows.csv", "field": "following_rank", "meaning": "AI/教师介入后的第几个后续事件", "analysis_note": "默认最多保留 30 分钟内后 5 个事件，便于分析支架后的行为变化。"},
        {"file": "raw/*.csv", "field": "*", "meaning": "平台原始或近原始记录", "analysis_note": "用于审计、复核和二次清洗，不建议直接作为全部统计指标。"},
    ]


def _classify_event(space: str, action: str, actor_type: str = "", metadata: Optional[dict] = None) -> Dict[str, Any]:
    text = f"{space} {action} {json.dumps(metadata or {}, ensure_ascii=False)}".lower()
    tags: List[str] = []
    if any(token in text for token in ["evidence", "resource", "citation", "资料", "证据"]):
        tags.append("evidence_use")
    if any(token in text for token in ["comment", "reply", "message", "chat", "讨论", "回复"]):
        tags.append("dialogue")
    if any(token in text for token in ["edit", "update", "commit", "document", "wiki", "snapshot", "修订", "保存"]):
        tags.append("artifact_construction")
    if any(token in text for token in ["challenge", "counter", "反驳", "质疑", "alternative"]):
        tags.append("critical_challenge")
    if any(token in text for token in ["help", "support", "teacher", "求助"]):
        tags.append("support_regulation")
    if any(token in text for token in ["submit", "archive", "task", "提交", "归档"]):
        tags.append("task_progress")
    return {
        "semantic_tags": ";".join(dict.fromkeys(tags)),
        "ai_related": actor_type in {"ai_assistant", "ai_tutor"} or "ai" in text,
        "teacher_related": actor_type == "teacher" or "teacher" in text or "教师" in text,
    }


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


@router.get("/courses/{course_id}/research-package")
async def export_course_research_package(
    course_id: str,
    include_files: bool = Query(True),
    include_raw_heartbeat: bool = Query(False),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Export one class as a structured research data package."""
    await _require_admin(current_user)
    course = await Course.get(course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    temp_path = temp_file.name
    temp_file.close()
    try:
        package_data = await _collect_course_research_package(course, include_raw_heartbeat=include_raw_heartbeat)
        await run_in_threadpool(
            _write_course_research_zip,
            temp_path,
            course,
            package_data,
            include_files,
        )
    except Exception as exc:
        _remove_temp_file(temp_path)
        logger.exception("Failed to build course research package for course_id=%s", course_id)
        raise HTTPException(status_code=500, detail=f"班级研究数据包生成失败：{exc}") from exc

    filename = f"aiscl-course-research-{_zip_safe_segment(course.name, str(course.id))}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}.zip"
    return StreamingResponse(
        _stream_file(temp_path),
        media_type="application/zip",
        headers={"Content-Disposition": content_disposition_header(filename)},
        background=BackgroundTask(_remove_temp_file, temp_path),
    )


async def _collect_course_research_package(course: Course, *, include_raw_heartbeat: bool) -> Dict[str, Any]:
    db = mongodb.get_database()
    projects = await Project.find(Project.course_id == str(course.id)).sort("name").to_list()
    project_ids = [str(project.id) for project in projects]
    project_name_map = {str(project.id): project.name for project in projects}

    member_user_ids = {
        str(user_id)
        for project in projects
        for user_id in [project.owner_id, project.leader_id, *[member.get("user_id") for member in project.members or []]]
        if user_id
    }
    if course.teacher_id:
        member_user_ids.add(str(course.teacher_id))
    member_user_ids.update(str(user_id) for user_id in course.students or [])
    user_object_ids = [ObjectId(user_id) for user_id in member_user_ids if ObjectId.is_valid(user_id)]
    users = await User.find({"_id": {"$in": user_object_ids}}).to_list() if user_object_ids else []
    user_code_map = _build_user_code_map(member_user_ids, users, course)

    chat_logs = await ChatLog.find({"project_id": {"$in": project_ids}}).sort("created_at").to_list() if project_ids else []
    research_events = await ResearchEvent.find({"project_id": {"$in": project_ids}}).sort("event_time").to_list() if project_ids else []
    activity_logs = await ActivityLog.find({"project_id": {"$in": project_ids}}).sort("timestamp").to_list() if project_ids else []
    resources = await Resource.find({"$or": [{"project_id": {"$in": project_ids}}, {"course_id": str(course.id)}]}).sort("uploaded_at").to_list()
    documents = await Document.find({"project_id": {"$in": project_ids}}).sort("updated_at").to_list() if project_ids else []
    wiki_items = await WikiItem.find({"project_id": {"$in": project_ids}}).sort("updated_at").to_list() if project_ids else []
    tasks = await Task.find({"project_id": {"$in": project_ids}}).sort("updated_at").to_list() if project_ids else []
    task_ids = [str(task.id) for task in tasks]
    task_artifacts = await TaskSubmissionArtifact.find({"task_id": {"$in": task_ids}}).sort("uploaded_at").to_list() if task_ids else []
    task_releases = await CourseTaskRelease.find(CourseTaskRelease.course_id == str(course.id)).sort("created_at").to_list()
    inquiry_snapshots = await InquirySnapshot.find({"project_id": {"$in": project_ids}}).sort("created_at").to_list() if project_ids else []
    ai_conversations = await AIConversation.find({"project_id": {"$in": project_ids}}).sort("created_at").to_list() if project_ids else []
    conversation_ids = [str(conversation.id) for conversation in ai_conversations]
    ai_messages = await AIMessage.find({"conversation_id": {"$in": conversation_ids}}).sort("created_at").to_list() if conversation_ids else []

    behavior_stream = await db["behavior_stream"].find(
        {"metadata.project_id": {"$in": project_ids}},
        {"_id": 0},
    ).sort("timestamp", 1).to_list(length=None) if project_ids else []
    heartbeat_stream = await db["heartbeat_stream"].find(
        {"metadata.project_id": {"$in": project_ids}},
        {"_id": 0},
    ).sort("timestamp", 1).to_list(length=None) if project_ids else []

    heartbeat_sessions = _sessionize_heartbeats(heartbeat_stream, user_code_map)
    event_sequence = _build_event_sequence(
        chat_logs=chat_logs,
        research_events=research_events,
        activity_logs=activity_logs,
        resources=resources,
        documents=documents,
        tasks=tasks,
        wiki_items=wiki_items,
        heartbeat_sessions=heartbeat_sessions,
        user_code_map=user_code_map,
        project_name_map=project_name_map,
    )
    intervention_windows = _build_intervention_windows(event_sequence)

    return {
        "projects": projects,
        "project_ids": project_ids,
        "project_name_map": project_name_map,
        "users": users,
        "user_code_map": user_code_map,
        "chat_logs": chat_logs,
        "research_events": research_events,
        "activity_logs": activity_logs,
        "behavior_stream": behavior_stream,
        "heartbeat_stream": heartbeat_stream if include_raw_heartbeat else [],
        "raw_heartbeat_count": len(heartbeat_stream),
        "heartbeat_sessions": heartbeat_sessions,
        "resources": resources,
        "documents": documents,
        "wiki_items": wiki_items,
        "tasks": tasks,
        "task_artifacts": task_artifacts,
        "task_releases": task_releases,
        "inquiry_snapshots": inquiry_snapshots,
        "ai_conversations": ai_conversations,
        "ai_messages": ai_messages,
        "event_sequence": event_sequence,
        "intervention_windows": intervention_windows,
    }


def _sessionize_heartbeats(heartbeats: List[Dict[str, Any]], user_code_map: Dict[str, str], gap_seconds: int = 180) -> List[Dict[str, Any]]:
    grouped: Dict[tuple[str, str], List[Dict[str, Any]]] = {}
    for heartbeat in heartbeats:
        metadata = heartbeat.get("metadata") or {}
        project_id = str(metadata.get("project_id") or "")
        user_id = str(metadata.get("user_id") or "")
        if not project_id or not user_id:
            continue
        grouped.setdefault((project_id, user_id), []).append(heartbeat)

    sessions: List[Dict[str, Any]] = []
    for (project_id, user_id), rows in grouped.items():
        rows.sort(key=lambda item: _datetime_or_none(item.get("timestamp")) or datetime.min.replace(tzinfo=timezone.utc))
        current: Optional[Dict[str, Any]] = None
        last_time: Optional[datetime] = None
        for row in rows:
            timestamp = _datetime_or_none(row.get("timestamp"))
            if not timestamp:
                continue
            metadata = row.get("metadata") or {}
            should_start = current is None or last_time is None or (timestamp - last_time).total_seconds() > gap_seconds
            if should_start:
                if current:
                    sessions.append(current)
                current = {
                    "session_id": f"session_{len(sessions) + 1:06d}",
                    "project_id": project_id,
                    "anonymous_id": _anonymize_user_id(user_id, user_code_map),
                    "start_time": timestamp,
                    "end_time": timestamp,
                    "duration_seconds": 0,
                    "heartbeat_count": 0,
                    "active_modules": set(),
                    "resource_ids": set(),
                    "overlap_ready": True,
                }
            assert current is not None
            current["end_time"] = timestamp
            current["heartbeat_count"] += 1
            if metadata.get("module"):
                current["active_modules"].add(metadata.get("module"))
            if metadata.get("resource_id"):
                current["resource_ids"].add(metadata.get("resource_id"))
            current["duration_seconds"] = max(0, int((current["end_time"] - current["start_time"]).total_seconds()))
            last_time = timestamp
        if current:
            sessions.append(current)

    for session in sessions:
        session["active_modules"] = ";".join(sorted(session["active_modules"]))
        session["resource_ids"] = ";".join(sorted(session["resource_ids"]))
        session["start_time"] = utc_isoformat(session["start_time"])
        session["end_time"] = utc_isoformat(session["end_time"])
    return sessions


def _build_event_sequence(
    *,
    chat_logs: List[ChatLog],
    research_events: List[ResearchEvent],
    activity_logs: List[ActivityLog],
    resources: List[Resource],
    documents: List[Document],
    tasks: List[Task],
    wiki_items: List[WikiItem],
    heartbeat_sessions: List[Dict[str, Any]],
    user_code_map: Dict[str, str],
    project_name_map: Dict[str, str],
) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    for item in chat_logs:
        events.append(_sequence_row(
            event_id=f"chat:{item.id}",
            project_id=item.project_id,
            project_name=project_name_map.get(item.project_id, ""),
            user_id=item.user_id,
            actor_type="student" if item.message_type == "text" else item.message_type,
            space="chat",
            action="message_send",
            object_type="chat_message",
            object_id=str(item.id),
            timestamp=item.created_at,
            content_length=len(item.content or ""),
            metadata=item.metadata,
            user_code_map=user_code_map,
        ))
    for item in research_events:
        events.append(_sequence_row(
            event_id=f"research:{item.id}",
            project_id=item.project_id,
            project_name=project_name_map.get(item.project_id, ""),
            user_id=item.user_id,
            actor_type=item.actor_type,
            space=item.event_domain,
            action=item.event_type,
            object_type="research_event",
            object_id=str(item.id),
            timestamp=item.event_time,
            stage_id=item.stage_id,
            metadata=item.payload,
            user_code_map=user_code_map,
        ))
    for item in activity_logs:
        events.append(_sequence_row(
            event_id=f"activity:{item.id}",
            project_id=item.project_id,
            project_name=project_name_map.get(item.project_id, ""),
            user_id=item.user_id,
            actor_type="student",
            space=item.module,
            action=item.action,
            object_type="activity_log",
            object_id=str(item.id),
            timestamp=item.timestamp,
            metadata=item.metadata,
            user_code_map=user_code_map,
        ))
    for item in resources:
        if item.project_id:
            events.append(_sequence_row(
                event_id=f"resource:{item.id}",
                project_id=item.project_id,
                project_name=project_name_map.get(item.project_id, ""),
                user_id=item.uploaded_by,
                actor_type="student",
                space="resource",
                action="resource_upload",
                object_type="resource",
                object_id=str(item.id),
                timestamp=item.uploaded_at,
                metadata={"filename": item.filename, "mime_type": item.mime_type, "size": item.size},
                user_code_map=user_code_map,
            ))
    for item in documents:
        events.append(_sequence_row(
            event_id=f"document:{item.id}",
            project_id=item.project_id,
            project_name=project_name_map.get(item.project_id, ""),
            user_id=item.last_modified_by,
            actor_type="student",
            space="document",
            action="document_update",
            object_type="document",
            object_id=str(item.id),
            timestamp=item.updated_at,
            content_length=len(item.content or ""),
            metadata={"title": item.title, "source_type": item.source_type},
            user_code_map=user_code_map,
        ))
    for item in tasks:
        timestamp = item.submitted_at or item.updated_at
        events.append(_sequence_row(
            event_id=f"task:{item.id}",
            project_id=item.project_id,
            project_name=project_name_map.get(item.project_id, ""),
            user_id=item.submitted_by,
            actor_type="system" if item.submitted_by == "system" else "student",
            space="task",
            action=item.submission_status or f"task_{item.column}",
            object_type="task",
            object_id=str(item.id),
            timestamp=timestamp,
            content_length=len(item.submission_note or ""),
            metadata={"title": item.title, "review_status": item.review_status},
            user_code_map=user_code_map,
        ))
    for item in wiki_items:
        events.append(_sequence_row(
            event_id=f"wiki:{item.id}",
            project_id=item.project_id,
            project_name=project_name_map.get(item.project_id, ""),
            user_id=item.updated_by or item.created_by,
            actor_type="student",
            space="wiki",
            action=f"wiki_{item.item_type}_update",
            object_type="wiki_item",
            object_id=str(item.id),
            timestamp=item.updated_at,
            content_length=len(item.content or ""),
            metadata={"source_type": item.source_type, "confidence_level": item.confidence_level},
            user_code_map=user_code_map,
        ))
    for session in heartbeat_sessions:
        events.append({
            "event_id": f"presence:{session['session_id']}",
            "project_id": session["project_id"],
            "project_name": project_name_map.get(session["project_id"], ""),
            "anonymous_id": session["anonymous_id"],
            "actor_type": "student",
            "space": "presence",
            "action": "online_session",
            "object_type": "heartbeat_session",
            "object_id": session["session_id"],
            "timestamp": session["start_time"],
            "stage_id": "",
            "content_length": 0,
            "semantic_tags": "presence",
            "ai_related": False,
            "teacher_related": False,
            "previous_event_id": "",
            "previous_action": "",
            "time_since_previous_seconds": "",
        })

    events.sort(key=lambda row: (row["project_id"], row["timestamp"] or ""))
    previous_by_project: Dict[str, Dict[str, Any]] = {}
    for row in events:
        previous = previous_by_project.get(row["project_id"])
        if previous:
            row["previous_event_id"] = previous["event_id"]
            row["previous_action"] = previous["action"]
            row["time_since_previous_seconds"] = _seconds_between_iso(previous["timestamp"], row["timestamp"])
        previous_by_project[row["project_id"]] = row
    return events


def _sequence_row(
    *,
    event_id: str,
    project_id: str,
    project_name: str,
    user_id: Optional[str],
    actor_type: str,
    space: str,
    action: str,
    object_type: str,
    object_id: str,
    timestamp: Any,
    user_code_map: Dict[str, str],
    stage_id: Optional[str] = None,
    content_length: int = 0,
    metadata: Optional[dict] = None,
) -> Dict[str, Any]:
    classification = _classify_event(space, action, actor_type, metadata)
    return {
        "event_id": event_id,
        "project_id": project_id,
        "project_name": project_name,
        "anonymous_id": _anonymize_user_id(user_id, user_code_map),
        "actor_type": actor_type,
        "space": space,
        "action": action,
        "object_type": object_type,
        "object_id": object_id,
        "timestamp": _safe_isoformat(timestamp),
        "stage_id": stage_id or "",
        "content_length": content_length,
        "semantic_tags": classification["semantic_tags"],
        "ai_related": classification["ai_related"],
        "teacher_related": classification["teacher_related"],
        "previous_event_id": "",
        "previous_action": "",
        "time_since_previous_seconds": "",
    }


def _seconds_between_iso(previous: str, current: str) -> str:
    try:
        previous_dt = datetime.fromisoformat(previous.replace("Z", "+00:00"))
        current_dt = datetime.fromisoformat(current.replace("Z", "+00:00"))
        return str(max(0, int((current_dt - previous_dt).total_seconds())))
    except Exception:
        return ""


def _build_intervention_windows(
    event_sequence: List[Dict[str, Any]],
    *,
    max_following_events: int = 5,
    max_gap_seconds: int = 30 * 60,
) -> List[Dict[str, Any]]:
    """Create compact windows after AI/teacher interventions for process analysis."""
    rows: List[Dict[str, Any]] = []
    events_by_project: Dict[str, List[Dict[str, Any]]] = {}
    for event in event_sequence:
        events_by_project.setdefault(event["project_id"], []).append(event)

    for project_events in events_by_project.values():
        for index, event in enumerate(project_events):
            source = ""
            if event.get("ai_related"):
                source = "ai"
            elif event.get("teacher_related"):
                source = "teacher"
            if not source:
                continue
            following_rank = 0
            for following in project_events[index + 1:]:
                lag_seconds = _seconds_between_iso(event["timestamp"], following["timestamp"])
                if not lag_seconds:
                    continue
                if int(lag_seconds) > max_gap_seconds:
                    break
                following_rank += 1
                rows.append({
                    "intervention_event_id": event["event_id"],
                    "intervention_source": source,
                    "project_id": event["project_id"],
                    "project_name": event["project_name"],
                    "intervention_timestamp": event["timestamp"],
                    "following_rank": following_rank,
                    "following_event_id": following["event_id"],
                    "following_anonymous_id": following["anonymous_id"],
                    "following_actor_type": following["actor_type"],
                    "following_space": following["space"],
                    "following_action": following["action"],
                    "lag_seconds": lag_seconds,
                    "following_semantic_tags": following["semantic_tags"],
                    "interpretation_guardrail": "只能解释为时间相邻的后续行为，需结合发言/产物内容确认是否构成响应。",
                })
                if following_rank >= max_following_events:
                    break
    return rows


def _write_course_research_zip(temp_path: str, course: Course, data: Dict[str, Any], include_files: bool) -> None:
    file_errors: List[Dict[str, Any]] = []
    user_code_map = data["user_code_map"]
    project_name_map = data["project_name_map"]
    with zipfile.ZipFile(temp_path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "metadata/export_manifest.json",
            json.dumps(
                {
                    "exported_at": utc_isoformat(datetime.utcnow()),
                    "course_id": str(course.id),
                    "course_name": course.name,
                    "semester": course.semester,
                    "include_files": include_files,
                    "raw_heartbeat_included": bool(data["heartbeat_stream"]),
                    "raw_heartbeat_count": data["raw_heartbeat_count"],
                    "heartbeat_session_gap_seconds": 180,
                    "structure": ["metadata", "raw", "cleaned", "analysis_ready", "files"],
                    "analysis_ready_files": [
                        "event_sequence.csv",
                        "intervention_windows.csv",
                        "group_summary.csv",
                        "student_summary.csv",
                    ],
                },
                ensure_ascii=False,
                indent=2,
            ).encode("utf-8"),
        )
        _write_csv(archive, "metadata/course.csv", [{
            "course_id": str(course.id),
            "course_name": course.name,
            "semester": course.semester,
            "teacher_id": _anonymize_user_id(course.teacher_id, user_code_map),
            "student_count": len(course.students or []),
            "project_count": len(data["projects"]),
            "created_at": course.created_at,
            "updated_at": course.updated_at,
        }], ["course_id", "course_name", "semester", "teacher_id", "student_count", "project_count", "created_at", "updated_at"])
        _write_csv(archive, "metadata/users_anonymized.csv", [
            {
                "anonymous_id": user_code_map.get(str(user.id), ""),
                "role": user.role,
                "class_id": user.class_id,
                "in_course_students": str(user.id) in set(course.students or []),
                "created_at": user.created_at,
            }
            for user in data["users"]
        ], ["anonymous_id", "role", "class_id", "in_course_students", "created_at"])
        _write_csv(archive, "metadata/behavior_codebook.csv", _behavior_codebook_rows(), ["space", "action", "analysis_use", "interpretation_note"])
        _write_csv(archive, "metadata/data_dictionary.csv", _data_dictionary_rows(), ["file", "field", "meaning", "analysis_note"])

        _write_csv(archive, "raw/groups.csv", [
            {
                "project_id": str(project.id),
                "project_name": project.name,
                "course_id": project.course_id,
                "leader_anonymous_id": _anonymize_user_id(project.leader_id, user_code_map),
                "member_count": len(project.members or []),
                "is_archived": project.is_archived,
                "created_at": project.created_at,
                "updated_at": project.updated_at,
            }
            for project in data["projects"]
        ], ["project_id", "project_name", "course_id", "leader_anonymous_id", "member_count", "is_archived", "created_at", "updated_at"])
        _write_csv(archive, "raw/group_members.csv", [
            {
                "project_id": str(project.id),
                "project_name": project.name,
                "anonymous_id": _anonymize_user_id(member.get("user_id"), user_code_map),
                "project_role": member.get("role") or "",
                "is_leader": member.get("user_id") == project.leader_id,
                "joined_at": member.get("joined_at"),
            }
            for project in data["projects"]
            for member in project.members or []
        ], ["project_id", "project_name", "anonymous_id", "project_role", "is_leader", "joined_at"])
        _write_csv(archive, "raw/chat_logs.csv", [
            {
                "id": str(item.id),
                "project_id": item.project_id,
                "anonymous_id": _anonymize_user_id(item.user_id, user_code_map),
                "message_type": item.message_type,
                "content": item.content,
                "content_length": len(item.content or ""),
                "mentions": [_anonymize_user_id(user_id, user_code_map) for user_id in item.mentions or []],
                "metadata": item.metadata,
                "created_at": item.created_at,
            }
            for item in data["chat_logs"]
        ], ["id", "project_id", "anonymous_id", "message_type", "content", "content_length", "mentions", "metadata", "created_at"])
        _write_csv(archive, "raw/research_events.csv", [
            {
                "id": str(item.id),
                "project_id": item.project_id,
                "group_id": item.group_id,
                "anonymous_id": _anonymize_user_id(item.user_id, user_code_map),
                "actor_type": item.actor_type,
                "event_domain": item.event_domain,
                "event_type": item.event_type,
                "stage_id": item.stage_id,
                "sequence_index": item.sequence_index,
                "payload": item.payload,
                "event_time": item.event_time,
                "created_at": item.created_at,
            }
            for item in data["research_events"]
        ], ["id", "project_id", "group_id", "anonymous_id", "actor_type", "event_domain", "event_type", "stage_id", "sequence_index", "payload", "event_time", "created_at"])
        _write_csv(archive, "raw/activity_logs.csv", [
            {
                "id": str(item.id),
                "project_id": item.project_id,
                "anonymous_id": _anonymize_user_id(item.user_id, user_code_map),
                "module": item.module,
                "action": item.action,
                "target_id": item.target_id,
                "duration": item.duration,
                "metadata": item.metadata,
                "timestamp": item.timestamp,
            }
            for item in data["activity_logs"]
        ], ["id", "project_id", "anonymous_id", "module", "action", "target_id", "duration", "metadata", "timestamp"])
        _write_csv(archive, "raw/behavior_stream.csv", [
            {
                "timestamp": item.get("timestamp"),
                "project_id": (item.get("metadata") or {}).get("project_id"),
                "anonymous_id": _anonymize_user_id((item.get("metadata") or {}).get("user_id"), user_code_map),
                "module": (item.get("metadata") or {}).get("module"),
                "action": (item.get("metadata") or {}).get("action"),
            }
            for item in data["behavior_stream"]
        ], ["timestamp", "project_id", "anonymous_id", "module", "action"])
        if data["heartbeat_stream"]:
            _write_csv(archive, "raw/heartbeat_stream.csv", [
                {
                    "timestamp": item.get("timestamp"),
                    "project_id": (item.get("metadata") or {}).get("project_id"),
                    "anonymous_id": _anonymize_user_id((item.get("metadata") or {}).get("user_id"), user_code_map),
                    "module": (item.get("metadata") or {}).get("module"),
                    "resource_id": (item.get("metadata") or {}).get("resource_id"),
                }
                for item in data["heartbeat_stream"]
            ], ["timestamp", "project_id", "anonymous_id", "module", "resource_id"])

        _write_domain_csvs(archive, data, user_code_map)

        _write_csv(archive, "cleaned/heartbeat_sessions.csv", data["heartbeat_sessions"], [
            "session_id", "project_id", "anonymous_id", "start_time", "end_time", "duration_seconds", "heartbeat_count", "active_modules", "resource_ids", "overlap_ready"
        ])
        _write_csv(archive, "analysis_ready/event_sequence.csv", data["event_sequence"], [
            "event_id", "project_id", "project_name", "anonymous_id", "actor_type", "space", "action", "object_type", "object_id", "timestamp", "stage_id", "previous_event_id", "previous_action", "time_since_previous_seconds", "content_length", "semantic_tags", "ai_related", "teacher_related"
        ])
        _write_csv(archive, "analysis_ready/intervention_windows.csv", data["intervention_windows"], [
            "intervention_event_id", "intervention_source", "project_id", "project_name", "intervention_timestamp", "following_rank", "following_event_id", "following_anonymous_id", "following_actor_type", "following_space", "following_action", "lag_seconds", "following_semantic_tags", "interpretation_guardrail"
        ])
        _write_summary_csvs(archive, data)

        if include_files:
            _write_package_files(archive, data, project_name_map, file_errors)
        _write_csv(archive, "metadata/file_export_errors.csv", file_errors, ["source", "id", "filename", "file_key", "error"])


def _write_domain_csvs(archive: zipfile.ZipFile, data: Dict[str, Any], user_code_map: Dict[str, str]) -> None:
    _write_csv(archive, "raw/resources.csv", [
        {
            "id": str(item.id),
            "project_id": item.project_id,
            "course_id": item.course_id,
            "scope": item.scope,
            "filename": item.filename,
            "file_key": item.file_key,
            "size": item.size,
            "mime_type": item.mime_type,
            "source_type": item.source_type,
            "uploaded_by": _anonymize_user_id(item.uploaded_by, user_code_map),
            "uploaded_at": item.uploaded_at,
            "parse_status": item.parse_status,
        }
        for item in data["resources"]
    ], ["id", "project_id", "course_id", "scope", "filename", "file_key", "size", "mime_type", "source_type", "uploaded_by", "uploaded_at", "parse_status"])
    _write_csv(archive, "raw/documents.csv", [
        {
            "id": str(item.id),
            "project_id": item.project_id,
            "title": item.title,
            "content_text_length": len(item.content or ""),
            "last_modified_by": _anonymize_user_id(item.last_modified_by, user_code_map),
            "is_archived": item.is_archived,
            "source_type": item.source_type,
            "course_task_release_id": item.course_task_release_id,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
        }
        for item in data["documents"]
    ], ["id", "project_id", "title", "content_text_length", "last_modified_by", "is_archived", "source_type", "course_task_release_id", "created_at", "updated_at"])
    _write_csv(archive, "raw/wiki_items.csv", [
        {
            "id": str(item.id),
            "project_id": item.project_id,
            "stage_id": item.stage_id,
            "item_type": item.item_type,
            "title": item.title,
            "content": item.content,
            "summary": item.summary,
            "source_type": item.source_type,
            "created_by": _anonymize_user_id(item.created_by, user_code_map),
            "updated_by": _anonymize_user_id(item.updated_by, user_code_map),
            "confidence_level": item.confidence_level,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
        }
        for item in data["wiki_items"]
    ], ["id", "project_id", "stage_id", "item_type", "title", "content", "summary", "source_type", "created_by", "updated_by", "confidence_level", "created_at", "updated_at"])
    _write_csv(archive, "raw/tasks.csv", [
        {
            "id": str(item.id),
            "project_id": item.project_id,
            "title": item.title,
            "column": item.column,
            "source_type": item.source_type,
            "course_task_release_id": item.course_task_release_id,
            "submission_status": item.submission_status,
            "submitted_by": _anonymize_user_id(item.submitted_by, user_code_map),
            "submitted_at": item.submitted_at,
            "review_status": item.review_status,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
        }
        for item in data["tasks"]
    ], ["id", "project_id", "title", "column", "source_type", "course_task_release_id", "submission_status", "submitted_by", "submitted_at", "review_status", "created_at", "updated_at"])
    _write_csv(archive, "raw/task_artifacts.csv", [
        {
            "id": str(item.id),
            "task_id": item.task_id,
            "project_id": item.project_id,
            "filename": item.filename,
            "file_key": item.file_key,
            "mime_type": item.mime_type,
            "size": item.size,
            "artifact_type": item.artifact_type,
            "uploaded_by": _anonymize_user_id(item.uploaded_by, user_code_map),
            "uploaded_at": item.uploaded_at,
        }
        for item in data["task_artifacts"]
    ], ["id", "task_id", "project_id", "filename", "file_key", "mime_type", "size", "artifact_type", "uploaded_by", "uploaded_at"])
    _write_csv(archive, "raw/inquiry_snapshots.csv", [
        {
            "id": str(item.id),
            "project_id": item.project_id,
            "snapshot_version": item.snapshot_version,
            "snapshot_type": item.snapshot_type,
            "data_size": len(item.data or b""),
            "created_by": _anonymize_user_id(item.created_by, user_code_map),
            "created_at": item.created_at,
        }
        for item in data["inquiry_snapshots"]
    ], ["id", "project_id", "snapshot_version", "snapshot_type", "data_size", "created_by", "created_at"])
    _write_csv(archive, "raw/ai_conversations.csv", [
        {
            "id": str(item.id),
            "project_id": item.project_id,
            "anonymous_id": _anonymize_user_id(item.user_id, user_code_map),
            "persona_id": item.persona_id,
            "title": item.title,
            "category": item.category,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
        }
        for item in data["ai_conversations"]
    ], ["id", "project_id", "anonymous_id", "persona_id", "title", "category", "created_at", "updated_at"])
    _write_csv(archive, "raw/ai_messages.csv", [
        {
            "id": str(item.id),
            "conversation_id": item.conversation_id,
            "role": item.role,
            "content": item.content,
            "content_length": len(item.content or ""),
            "citations": item.citations,
            "metadata": item.metadata,
            "created_at": item.created_at,
        }
        for item in data["ai_messages"]
    ], ["id", "conversation_id", "role", "content", "content_length", "citations", "metadata", "created_at"])
    _write_csv(archive, "raw/course_task_releases.csv", [
        {
            "id": str(item.id),
            "course_id": item.course_id,
            "title": item.title,
            "due_at": item.due_at,
            "allow_late_submission": item.allow_late_submission,
            "status": item.status,
            "created_by": _anonymize_user_id(item.created_by, user_code_map),
            "created_at": item.created_at,
            "updated_at": item.updated_at,
            "published_at": item.published_at,
            "closed_at": item.closed_at,
        }
        for item in data["task_releases"]
    ], ["id", "course_id", "title", "due_at", "allow_late_submission", "status", "created_by", "created_at", "updated_at", "published_at", "closed_at"])


def _write_summary_csvs(archive: zipfile.ZipFile, data: Dict[str, Any]) -> None:
    project_ids = data["project_ids"]
    sequence = data["event_sequence"]
    sessions = data["heartbeat_sessions"]
    _write_csv(archive, "analysis_ready/group_summary.csv", [
        {
            "project_id": project_id,
            "project_name": data["project_name_map"].get(project_id, ""),
            "event_count": sum(1 for row in sequence if row["project_id"] == project_id),
            "chat_count": sum(1 for row in sequence if row["project_id"] == project_id and row["space"] == "chat"),
            "artifact_event_count": sum(1 for row in sequence if row["project_id"] == project_id and "artifact_construction" in row["semantic_tags"]),
            "ai_related_count": sum(1 for row in sequence if row["project_id"] == project_id and row["ai_related"]),
            "teacher_related_count": sum(1 for row in sequence if row["project_id"] == project_id and row["teacher_related"]),
            "online_session_minutes": round(sum(int(row["duration_seconds"]) for row in sessions if row["project_id"] == project_id) / 60, 2),
        }
        for project_id in project_ids
    ], ["project_id", "project_name", "event_count", "chat_count", "artifact_event_count", "ai_related_count", "teacher_related_count", "online_session_minutes"])
    anonymous_ids = sorted({row["anonymous_id"] for row in sequence if row.get("anonymous_id")})
    _write_csv(archive, "analysis_ready/student_summary.csv", [
        {
            "anonymous_id": anonymous_id,
            "event_count": sum(1 for row in sequence if row["anonymous_id"] == anonymous_id),
            "chat_count": sum(1 for row in sequence if row["anonymous_id"] == anonymous_id and row["space"] == "chat"),
            "resource_event_count": sum(1 for row in sequence if row["anonymous_id"] == anonymous_id and row["space"] == "resource"),
            "artifact_event_count": sum(1 for row in sequence if row["anonymous_id"] == anonymous_id and "artifact_construction" in row["semantic_tags"]),
            "online_session_minutes": round(sum(int(row["duration_seconds"]) for row in sessions if row["anonymous_id"] == anonymous_id) / 60, 2),
        }
        for anonymous_id in anonymous_ids
    ], ["anonymous_id", "event_count", "chat_count", "resource_event_count", "artifact_event_count", "online_session_minutes"])


def _write_package_files(archive: zipfile.ZipFile, data: Dict[str, Any], project_name_map: Dict[str, str], errors: List[Dict[str, Any]]) -> None:
    for resource in data["resources"]:
        if not resource.file_key:
            continue
        group = _zip_safe_segment(project_name_map.get(resource.project_id or "", "course_resources"))
        filename = _zip_safe_segment(resource.filename, "resource")
        path = f"files/resources/{group}/{str(resource.id)}_{filename}"
        try:
            with archive.open(path, "w") as writer:
                storage_service.write_file_to(resource.file_key, writer)
        except Exception as exc:
            errors.append({"source": "resource", "id": str(resource.id), "filename": resource.filename, "file_key": resource.file_key, "error": str(exc)})
    for artifact in data["task_artifacts"]:
        group = _zip_safe_segment(project_name_map.get(artifact.project_id, artifact.project_id))
        filename = _zip_safe_segment(artifact.filename, "artifact")
        path = f"files/task_artifacts/{group}/{artifact.task_id}/{str(artifact.id)}_{filename}"
        try:
            with archive.open(path, "w") as writer:
                storage_service.write_file_to(artifact.file_key, writer)
        except Exception as exc:
            errors.append({"source": "task_artifact", "id": str(artifact.id), "filename": artifact.filename, "file_key": artifact.file_key, "error": str(exc)})
    for document in data["documents"]:
        group = _zip_safe_segment(project_name_map.get(document.project_id, document.project_id))
        title = _zip_safe_segment(document.title, "document")
        archive.writestr(
            f"files/documents/{group}/{str(document.id)}_{title}.html",
            (document.content or "").encode("utf-8"),
        )


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
