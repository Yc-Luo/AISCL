"""Admin APIs for research data management and export."""

from __future__ import annotations

import asyncio
import csv
import hashlib
import hmac
import io
import json
import logging
import os
import re
import tempfile
import time
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
from app.core.config import settings
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
from app.repositories.doc_comment import DocComment
from app.repositories.export_job import ExportJob
from app.repositories.inquiry_snapshot import InquirySnapshot
from app.repositories.learning_object_memory import LearningObjectMemory
from app.repositories.project import Project
from app.repositories.research_event import ResearchEvent
from app.repositories.resource import Resource
from app.repositories.scaffold_round_memory import ScaffoldRoundMemory
from app.repositories.system_config import SystemConfig
from app.repositories.task import Task
from app.repositories.task_submission_artifact import TaskSubmissionArtifact
from app.repositories.user import User
from app.repositories.wiki_item import WikiItem
from app.services.storage_service import storage_service

router = APIRouter(prefix="/admin/data", tags=["admin-data"])
logger = logging.getLogger(__name__)
EXPORT_DIR = os.path.join(tempfile.gettempdir(), "aiscl_exports")
EXPORT_DOWNLOAD_LINK_TTL_SECONDS = 10 * 60

CURRENT_EXPORT_STAGE_SEQUENCE = [
    "problem_construction",
    "meaning_exploration",
    "explanation_integration",
    "application_solution",
]

EXPORT_STAGE_ALIASES = {
    "orientation": "problem_construction",
    "task_import": "problem_construction",
    "planning": "problem_construction",
    "problem_planning": "problem_construction",
    "problem_construction": "problem_construction",
    "问题构建": "problem_construction",
    "问题建构": "problem_construction",
    "inquiry": "meaning_exploration",
    "evidence_exploration": "meaning_exploration",
    "meaning_exploration": "meaning_exploration",
    "证据探究": "meaning_exploration",
    "意义探索": "meaning_exploration",
    "argumentation": "explanation_integration",
    "explanation_integration": "explanation_integration",
    "论证协商": "explanation_integration",
    "解释整合": "explanation_integration",
    "revision": "application_solution",
    "reflection_revision": "application_solution",
    "summary": "application_solution",
    "reflection": "application_solution",
    "application_solution": "application_solution",
    "反思修订": "application_solution",
    "应用解决": "application_solution",
}

EXPORT_STAGE_LABELS = {
    "problem_construction": "问题构建",
    "meaning_exploration": "意义探索",
    "explanation_integration": "解释整合",
    "application_solution": "应用解决",
}


class RetentionCleanupRequest(BaseModel):
    """Retention cleanup request."""

    collections: List[str]
    older_than_days: int
    confirm_operational_only: bool = True


class ConfigRestoreRequest(BaseModel):
    """System configuration restore request."""

    configs: List[Dict[str, Any]]


class CourseResearchExportJobRequest(BaseModel):
    """Create course research export job request."""

    include_files: bool = False
    include_raw_heartbeat: bool = False


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


def _export_download_signature(job: ExportJob, expires: int) -> str:
    payload = f"{job.id}:{expires}:{job.file_path or ''}:{job.file_size or 0}"
    return hmac.new(settings.SECRET_KEY.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def _verify_export_download_signature(job: ExportJob, expires: int, signature: str) -> None:
    if expires < int(time.time()):
        raise HTTPException(status_code=403, detail="Download link has expired")
    expected = _export_download_signature(job, expires)
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=403, detail="Invalid download signature")


def _export_file_response(job: ExportJob) -> StreamingResponse:
    if job.status != "completed" or not job.file_path or not os.path.exists(job.file_path):
        raise HTTPException(status_code=409, detail="Export job is not ready for download")
    return StreamingResponse(
        _stream_file(job.file_path),
        media_type="application/zip",
        headers={
            "Content-Disposition": content_disposition_header(job.filename or f"aiscl-export-{job.id}.zip"),
            "Content-Length": str(os.path.getsize(job.file_path)),
        },
    )


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


def _normalize_export_stage_id(stage_id: Any, fallback: Optional[str] = None) -> str:
    raw = str(stage_id or "").strip()
    normalized = EXPORT_STAGE_ALIASES.get(raw)
    if normalized:
        return normalized
    fallback_raw = str(fallback or "").strip()
    fallback_normalized = EXPORT_STAGE_ALIASES.get(fallback_raw)
    if fallback_normalized:
        return fallback_normalized
    if raw in CURRENT_EXPORT_STAGE_SEQUENCE:
        return raw
    return "problem_construction"


def _export_stage_label(stage_id: Any) -> str:
    return EXPORT_STAGE_LABELS.get(_normalize_export_stage_id(stage_id), "问题构建")


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
        {"file": "01_class_index/*.csv", "field": "*", "meaning": "班级层索引与汇总", "analysis_note": "用于确认班级、小组、匿名成员和实验条件，不作为过程挖掘主表。"},
        {"file": "02_groups/*/process/process_event_log_full.csv", "field": "case_id", "meaning": "过程挖掘主案例 ID，固定为小组 project_id", "analysis_note": "一个班包含多个小组，正式过程分析应先按 case_id/小组隔离。"},
        {"file": "02_groups/*/process/process_event_log_full.csv", "field": "subcase_id", "meaning": "小组-阶段子案例 ID", "analysis_note": "用于问题构建、意义探索、解释整合、应用解决等阶段内过程分析。"},
        {"file": "02_groups/*/process/process_event_log_full.csv", "field": "event_id", "meaning": "统一事件锚点", "analysis_note": "跨 process/content/raw 表对齐时优先使用 event_id。"},
        {"file": "02_groups/*/process/process_event_log_full.csv", "field": "content_ref", "meaning": "内容证据引用 ID", "analysis_note": "用于连接聊天全文、AI 回复、文档快照、批注、资源清单等 content 表。"},
        {"file": "02_groups/*/process/process_event_log_balanced.csv", "field": "*", "meaning": "平衡后的分析事件表", "analysis_note": "保留关键节点并弱化过密低层操作，适合直接导入过程挖掘工具。"},
        {"file": "02_groups/*/process/event_object_links.csv", "field": "relation_type", "meaning": "事件与对象的关系", "analysis_note": "用于追踪同一文档、资源、任务或探究对象在多个事件中的连续变化。"},
        {"file": "02_groups/*/content/chat_transcript.csv", "field": "message_text", "meaning": "小组聊天原文", "analysis_note": "可人工/AI 编码后按 event_id 或 content_ref 合回过程事件表。"},
        {"file": "02_groups/*/content/ai_transcript.csv", "field": "message_text", "meaning": "个人 AI/助手对话内容", "analysis_note": "用于分析 AI 支架暴露和学生后续响应，需结合 process/intervention_windows。"},
        {"file": "02_groups/*/content/document_snapshots.csv", "field": "plain_text/html", "meaning": "共享/个人文档保存时的文本和 HTML", "analysis_note": "用于分析撰写成果和修订方向。"},
        {"file": "02_groups/*/content/document_comments.csv", "field": "comment_text", "meaning": "文档批注、回复和解决状态", "analysis_note": "用于分析同伴反馈、修订协商和观点澄清。"},
        {"file": "02_groups/*/content/document_update_operations.csv", "field": "source_granularity", "meaning": "文档写作事件粒度，包含 yjs_realtime_update 与 save_or_commit_event", "analysis_note": "新数据可分析实时协同编辑密度；旧数据会回填保存/提交级写作轨迹，不能解释为逐字编辑。"},
        {"file": "metadata/users_anonymized.csv", "field": "anonymous_id", "meaning": "匿名学习者/教师编号", "analysis_note": "用于替代真实 user_id。"},
        {"file": "metadata/group_conditions.csv", "field": "condition_label", "meaning": "小组实验条件标签", "analysis_note": "用于实验组/对照组、AI 支架模式和过程支架模式比较。"},
        {"file": "groups/*", "field": "*", "meaning": "按小组拆分后的原始、清洗和分析就绪数据", "analysis_note": "避免研究者从全班混合表手工筛选小组数据。"},
        {"file": "cleaned/heartbeat_sessions.csv", "field": "session_id", "meaning": "由连续心跳合并生成的在线会话", "analysis_note": "默认间隔超过 180 秒切分新会话。"},
        {"file": "cleaned/heartbeat_sessions.csv", "field": "overlap_ready", "meaning": "是否可用于共同在线分析", "analysis_note": "同组成员 session 可进一步计算重叠时长。"},
        {"file": "raw/group_members.csv", "field": "project_role", "meaning": "小组内成员身份", "analysis_note": "用于解释组长/成员责任分工与行为差异。"},
        {"file": "analysis_ready/event_sequence.csv", "field": "previous_event_id", "meaning": "同一小组内前一事件", "analysis_note": "用于滞后序列、过程挖掘和行为链解释。"},
        {"file": "analysis_ready/event_sequence.csv", "field": "time_since_previous_seconds", "meaning": "与前一事件的时间间隔", "analysis_note": "过长间隔不宜解释为直接响应。"},
        {"file": "analysis_ready/event_sequence.csv", "field": "semantic_tags", "meaning": "由事件类型或元数据推断的初步标签", "analysis_note": "正式论文分析前建议抽样人工校验。"},
        {"file": "analysis_ready/event_sequence.csv", "field": "ai_related", "meaning": "是否与 AI 支架相关", "analysis_note": "用于比较 AI 介入前后行为链。"},
        {"file": "analysis_ready/event_sequence.csv", "field": "teacher_related", "meaning": "是否与教师介入相关", "analysis_note": "用于识别低干预支持。"},
        {"file": "analysis_ready/intervention_windows.csv", "field": "following_rank", "meaning": "AI/教师介入后的第几个后续事件", "analysis_note": "默认最多保留 30 分钟内后 5 个事件，便于分析支架后的行为变化。"},
        {"file": "analysis_ready/intervention_exposure.csv", "field": "intervention_count", "meaning": "按小组、阶段和介入来源聚合的干预剂量", "analysis_note": "用于分析 AI/教师支架暴露量和学生后续响应。"},
        {"file": "analysis_ready/group_stage_summary.csv", "field": "stage_id", "meaning": "小组在不同阶段的过程行为汇总", "analysis_note": "用于比较问题构建、意义探索、解释整合、应用解决等阶段表现。"},
        {"file": "raw/*.csv", "field": "*", "meaning": "平台原始或近原始记录", "analysis_note": "用于审计、复核和二次清洗，不建议直接作为全部统计指标。"},
    ]


def _classify_event(space: str, action: str, actor_type: str = "", metadata: Optional[dict] = None) -> Dict[str, Any]:
    text = f"{space} {action} {json.dumps(_json_safe(metadata or {}), ensure_ascii=False)}".lower()
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


CONDITION_FIELDNAMES = [
    "project_id",
    "project_name",
    "course_id",
    "condition_label",
    "group_condition",
    "ai_scaffold_mode",
    "process_scaffold_mode",
    "stage_control_mode",
    "enabled_scaffold_layers",
    "enabled_scaffold_roles",
    "enabled_rule_set",
    "template_key",
    "template_label",
    "graph_version",
    "current_stage",
    "export_profile",
    "created_at",
    "updated_at",
]

EVENT_SEQUENCE_FIELDNAMES = [
    "event_id",
    "project_id",
    "project_name",
    "condition_label",
    "group_condition",
    "ai_scaffold_mode",
    "process_scaffold_mode",
    "stage_control_mode",
    "anonymous_id",
    "actor_type",
    "space",
    "action",
    "object_type",
    "object_id",
    "timestamp",
    "stage_id",
    "stage_label_zh",
    "previous_event_id",
    "previous_action",
    "time_since_previous_seconds",
    "content_length",
    "semantic_tags",
    "ai_related",
    "teacher_related",
]

PROCESS_EVENT_LOG_FIELDNAMES = [
    "case_id",
    "subcase_id",
    "event_id",
    "timestamp",
    "activity",
    "activity_label_zh",
    "actor_id",
    "actor_type",
    "role_in_group",
    "space",
    "stage_id",
    "stage_label_zh",
    "object_type",
    "object_id",
    "content_ref",
    "content_length",
    "source_table",
    "source_id",
    "previous_event_id",
    "previous_activity",
    "time_since_previous_sec",
    "is_ai_intervention",
    "ai_role",
    "is_teacher_intervention",
    "condition_label",
    "group_condition",
    "ai_scaffold_mode",
    "process_scaffold_mode",
    "stage_control_mode",
]

EVENT_OBJECT_LINK_FIELDNAMES = [
    "case_id",
    "event_id",
    "object_type",
    "object_id",
    "relation_type",
    "content_ref",
    "source_table",
    "source_id",
]

CHAT_TRANSCRIPT_FIELDNAMES = [
    "case_id",
    "event_id",
    "content_ref",
    "speaker_id",
    "speaker_type",
    "message_type",
    "message_text",
    "content_length",
    "mentions",
    "metadata",
    "created_at",
]

AI_TRANSCRIPT_FIELDNAMES = [
    "case_id",
    "event_id",
    "content_ref",
    "conversation_id",
    "actor_id",
    "role",
    "persona_id",
    "category",
    "message_text",
    "content_length",
    "citations",
    "metadata",
    "created_at",
]

DOCUMENT_SNAPSHOT_FIELDNAMES = [
    "case_id",
    "event_id",
    "content_ref",
    "document_id",
    "title",
    "scope",
    "owner_id",
    "last_modified_by",
    "plain_text",
    "html",
    "content_length",
    "source_type",
    "course_task_release_id",
    "created_at",
    "updated_at",
]

DOCUMENT_COMMENT_FIELDNAMES = [
    "case_id",
    "event_id",
    "content_ref",
    "comment_id",
    "document_id",
    "message_index",
    "author_id",
    "comment_text",
    "status",
    "anchor_context",
    "mentioned_user_ids",
    "created_at",
    "updated_at",
]

DOCUMENT_UPDATE_OPERATION_FIELDNAMES = [
    "case_id",
    "event_id",
    "content_ref",
    "document_id",
    "actor_id",
    "source_granularity",
    "operation_type",
    "operation_id",
    "client_id",
    "payload_size",
    "content_length",
    "timestamp",
    "analysis_note",
]

RESOURCE_MANIFEST_FIELDNAMES = [
    "case_id",
    "event_id",
    "content_ref",
    "resource_id",
    "filename",
    "size",
    "mime_type",
    "source_type",
    "uploaded_by",
    "uploaded_at",
    "parse_status",
    "parsed_markdown_available",
    "parsed_content_available",
]

INQUIRY_OBJECT_FIELDNAMES = [
    "case_id",
    "event_id",
    "content_ref",
    "snapshot_id",
    "snapshot_version",
    "snapshot_type",
    "data_size",
    "compressed",
    "created_by",
    "created_at",
    "analysis_note",
]

INTERVENTION_WINDOW_FIELDNAMES = [
    "intervention_event_id",
    "intervention_source",
    "project_id",
    "project_name",
    "condition_label",
    "group_condition",
    "ai_scaffold_mode",
    "process_scaffold_mode",
    "stage_control_mode",
    "intervention_timestamp",
    "following_rank",
    "following_event_id",
    "following_anonymous_id",
    "following_actor_type",
    "following_space",
    "following_action",
    "lag_seconds",
    "following_semantic_tags",
    "interpretation_guardrail",
]

GROUP_SUMMARY_FIELDNAMES = [
    "project_id",
    "project_name",
    "condition_label",
    "group_condition",
    "ai_scaffold_mode",
    "process_scaffold_mode",
    "stage_control_mode",
    "event_count",
    "chat_count",
    "artifact_event_count",
    "ai_related_count",
    "teacher_related_count",
    "online_session_minutes",
]

STUDENT_SUMMARY_FIELDNAMES = [
    "project_id",
    "project_name",
    "condition_label",
    "group_condition",
    "ai_scaffold_mode",
    "process_scaffold_mode",
    "stage_control_mode",
    "anonymous_id",
    "event_count",
    "chat_count",
    "resource_event_count",
    "artifact_event_count",
    "online_session_minutes",
]

GROUP_STAGE_SUMMARY_FIELDNAMES = [
    "project_id",
    "project_name",
    "condition_label",
    "group_condition",
    "ai_scaffold_mode",
    "process_scaffold_mode",
    "stage_control_mode",
    "stage_id",
    "stage_label_zh",
    "event_count",
    "chat_count",
    "student_turn_count",
    "ai_prompt_count",
    "teacher_support_count",
    "evidence_event_count",
    "challenge_event_count",
    "artifact_event_count",
    "resource_event_count",
    "document_update_count",
    "wiki_update_count",
    "online_session_minutes",
]

INTERVENTION_EXPOSURE_FIELDNAMES = [
    "project_id",
    "project_name",
    "condition_label",
    "group_condition",
    "ai_scaffold_mode",
    "process_scaffold_mode",
    "stage_control_mode",
    "intervention_source",
    "agent_role",
    "stage_id",
    "stage_label_zh",
    "intervention_count",
    "first_intervention_at",
    "last_intervention_at",
    "student_followup_count_5min",
    "student_followup_count_30min",
]

LEARNING_OBJECT_MEMORY_FIELDNAMES = [
    "id",
    "project_id",
    "group_id",
    "stage_id",
    "condition_type",
    "experiment_version_id",
    "optimization_version_id",
    "object_type",
    "title",
    "content",
    "keywords",
    "source_types",
    "source_refs",
    "created_by_type",
    "created_by_anonymous_id",
    "status",
    "verification_state",
    "confidence_score",
    "recency_score",
    "source_quality_score",
    "collaboration_score",
    "last_confirmed_at",
    "last_used_at",
    "superseded_by",
    "version",
    "created_at",
    "updated_at",
]

SCAFFOLD_ROUND_MEMORY_FIELDNAMES = [
    "id",
    "project_id",
    "group_id",
    "stage_id",
    "condition_type",
    "experiment_version_id",
    "optimization_version_id",
    "trigger_type",
    "trigger_reason",
    "input_message_id",
    "output_message_id",
    "read_memory_ids",
    "routing_mode",
    "selected_roles",
    "primary_role",
    "retrieval_sources",
    "response_text",
    "response_length",
    "response_style",
    "student_visible",
    "followup_window_start",
    "followup_window_end",
    "followup_events",
    "student_response_type",
    "outcome_label",
    "created_at",
    "updated_at",
]


def _join_list(value: Any) -> str:
    if isinstance(value, (list, tuple, set)):
        return ";".join(str(item) for item in value if item is not None)
    if value is None:
        return ""
    return str(value)


def _project_condition_row(project: Project) -> Dict[str, Any]:
    experiment = project.experiment_version or {}
    group_condition = experiment.get("group_condition") or ""
    ai_mode = experiment.get("ai_scaffold_mode") or ""
    process_mode = experiment.get("process_scaffold_mode") or ""
    condition_label = (
        group_condition
        or experiment.get("template_label")
        or experiment.get("template_key")
        or experiment.get("version_name")
        or "unspecified"
    )
    return {
        "project_id": str(project.id),
        "project_name": project.name,
        "course_id": project.course_id,
        "condition_label": condition_label,
        "group_condition": group_condition,
        "ai_scaffold_mode": ai_mode,
        "process_scaffold_mode": process_mode,
        "stage_control_mode": experiment.get("stage_control_mode") or "",
        "enabled_scaffold_layers": _join_list(experiment.get("enabled_scaffold_layers")),
        "enabled_scaffold_roles": _join_list(experiment.get("enabled_scaffold_roles")),
        "enabled_rule_set": experiment.get("enabled_rule_set") or "",
        "template_key": experiment.get("template_key") or project.inherited_template_key or "",
        "template_label": experiment.get("template_label") or project.inherited_template_label or "",
        "graph_version": experiment.get("graph_version") or "",
        "current_stage": _normalize_export_stage_id(experiment.get("current_stage")),
        "export_profile": experiment.get("export_profile") or "",
        "created_at": project.created_at,
        "updated_at": project.updated_at,
    }


def _condition_event_fields(condition: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    condition = condition or {}
    return {
        "condition_label": condition.get("condition_label", ""),
        "group_condition": condition.get("group_condition", ""),
        "ai_scaffold_mode": condition.get("ai_scaffold_mode", ""),
        "process_scaffold_mode": condition.get("process_scaffold_mode", ""),
        "stage_control_mode": condition.get("stage_control_mode", ""),
    }


def _group_dir_name(project_id: str, project_name_map: Dict[str, str]) -> str:
    name = project_name_map.get(project_id, project_id)
    return f"{_zip_safe_segment(project_id[:8], 'group')}_{_zip_safe_segment(name, 'group')}"


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
    include_files: bool = Query(False),
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
        headers={
            "Content-Disposition": content_disposition_header(filename),
            "Content-Length": str(os.path.getsize(temp_path)),
        },
        background=BackgroundTask(_remove_temp_file, temp_path),
    )


def _export_job_response(job: ExportJob) -> Dict[str, Any]:
    return {
        "id": str(job.id),
        "job_type": job.job_type,
        "status": job.status,
        "course_id": job.course_id,
        "course_name": job.course_name,
        "include_files": job.include_files,
        "include_raw_heartbeat": job.include_raw_heartbeat,
        "progress": job.progress,
        "message": job.message,
        "filename": job.filename,
        "file_size": job.file_size,
        "error": job.error,
        "created_at": utc_isoformat(job.created_at),
        "started_at": utc_isoformat(job.started_at) if job.started_at else None,
        "completed_at": utc_isoformat(job.completed_at) if job.completed_at else None,
        "updated_at": utc_isoformat(job.updated_at),
        "download_url": f"/api/v1/admin/data/export-jobs/{job.id}/download" if job.status == "completed" else None,
    }


@router.post("/courses/{course_id}/research-package/jobs", status_code=status.HTTP_202_ACCEPTED)
async def create_course_research_package_job(
    course_id: str,
    request: CourseResearchExportJobRequest,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Create an asynchronous course research package export job."""
    await _require_admin(current_user)
    course = await Course.get(course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    job = ExportJob(
        course_id=course_id,
        course_name=course.name,
        requested_by=str(current_user.id),
        include_files=request.include_files,
        include_raw_heartbeat=request.include_raw_heartbeat,
        progress=0,
        message="导出任务已创建，等待后台生成。",
    )
    await job.insert()
    asyncio.create_task(_run_course_research_export_job(str(job.id)))
    return _export_job_response(job)


@router.get("/export-jobs/{job_id}")
async def get_export_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return export job state."""
    await _require_admin(current_user)
    job = await ExportJob.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")
    return _export_job_response(job)


@router.get("/export-jobs/{job_id}/download-link")
async def get_export_job_download_link(
    job_id: str,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return a short-lived browser-native download URL for a completed export."""
    await _require_admin(current_user)
    job = await ExportJob.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")
    if job.status != "completed" or not job.file_path or not os.path.exists(job.file_path):
        raise HTTPException(status_code=409, detail="Export job is not ready for download")
    expires = int(time.time()) + EXPORT_DOWNLOAD_LINK_TTL_SECONDS
    signature = _export_download_signature(job, expires)
    return {
        "download_url": f"/api/v1/admin/data/export-jobs/{job_id}/signed-download?expires={expires}&signature={signature}",
        "expires_at": utc_isoformat(datetime.fromtimestamp(expires, tz=timezone.utc)),
        "filename": job.filename,
        "file_size": job.file_size,
    }


@router.get("/export-jobs/{job_id}/download")
async def download_export_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Download a completed export job ZIP file."""
    await _require_admin(current_user)
    job = await ExportJob.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")
    return _export_file_response(job)


@router.get("/export-jobs/{job_id}/signed-download")
async def signed_download_export_job(
    job_id: str,
    expires: int = Query(...),
    signature: str = Query(...),
) -> StreamingResponse:
    """Download a completed export job through a short-lived signed URL."""
    job = await ExportJob.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")
    _verify_export_download_signature(job, expires, signature)
    return _export_file_response(job)


async def _run_course_research_export_job(job_id: str) -> None:
    job = await ExportJob.get(job_id)
    if not job:
        return
    try:
        job.status = "running"
        job.progress = 5
        job.message = "正在读取班级与小组研究数据。"
        job.started_at = datetime.utcnow()
        job.updated_at = datetime.utcnow()
        await job.save()

        course = await Course.get(job.course_id)
        if not course:
            raise ValueError("Course not found")

        package_data = await _collect_course_research_package(course, include_raw_heartbeat=job.include_raw_heartbeat)
        job.progress = 45
        job.message = "正在生成小组隔离的过程挖掘数据包。"
        job.updated_at = datetime.utcnow()
        await job.save()

        os.makedirs(EXPORT_DIR, exist_ok=True)
        filename = f"aiscl-course-research-{_zip_safe_segment(course.name, str(course.id))}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}.zip"
        temp_path = os.path.join(EXPORT_DIR, f"{job_id}.zip.tmp")
        final_path = os.path.join(EXPORT_DIR, f"{job_id}.zip")
        await run_in_threadpool(
            _write_course_research_zip,
            temp_path,
            course,
            package_data,
            job.include_files,
        )
        os.replace(temp_path, final_path)

        job.status = "completed"
        job.progress = 100
        job.message = "导出完成，可以下载。"
        job.filename = filename
        job.file_path = final_path
        job.file_size = os.path.getsize(final_path)
        job.completed_at = datetime.utcnow()
        job.updated_at = datetime.utcnow()
        await job.save()
    except Exception as exc:
        logger.exception("Failed to run course research export job job_id=%s", job_id)
        try:
            if job.file_path and os.path.exists(job.file_path):
                _remove_temp_file(job.file_path)
            temp_path = os.path.join(EXPORT_DIR, f"{job_id}.zip.tmp")
            _remove_temp_file(temp_path)
        except Exception:
            logger.warning("Failed to cleanup export job temp files job_id=%s", job_id, exc_info=True)
        job.status = "failed"
        job.progress = 100
        job.message = "导出失败。"
        job.error = str(exc)
        job.completed_at = datetime.utcnow()
        job.updated_at = datetime.utcnow()
        await job.save()


async def _collect_course_research_package(course: Course, *, include_raw_heartbeat: bool) -> Dict[str, Any]:
    db = mongodb.get_database()
    projects = await Project.find(Project.course_id == str(course.id)).sort("name").to_list()
    project_ids = [str(project.id) for project in projects]
    project_name_map = {str(project.id): project.name for project in projects}
    project_condition_rows = [_project_condition_row(project) for project in projects]
    project_condition_map = {row["project_id"]: row for row in project_condition_rows}

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
    learning_object_memories = await LearningObjectMemory.find({"project_id": {"$in": project_ids}}).sort("updated_at").to_list() if project_ids else []
    scaffold_round_memories = await ScaffoldRoundMemory.find({"project_id": {"$in": project_ids}}).sort("created_at").to_list() if project_ids else []
    activity_logs = await ActivityLog.find({"project_id": {"$in": project_ids}}).sort("timestamp").to_list() if project_ids else []
    resources = await Resource.find({"$or": [{"project_id": {"$in": project_ids}}, {"course_id": str(course.id)}]}).sort("uploaded_at").to_list()
    documents = await Document.find({"project_id": {"$in": project_ids}}).sort("updated_at").to_list() if project_ids else []
    document_ids = [str(document.id) for document in documents]
    doc_comments = await DocComment.find({"document_id": {"$in": document_ids}}).sort("updated_at").to_list() if document_ids else []
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
        {"_id": 0, "timestamp": 1, "metadata.project_id": 1, "metadata.user_id": 1, "metadata.module": 1, "metadata.action": 1, "metadata.resource_id": 1, "metadata.duration": 1, "metadata.event_metadata": 1},
    ).sort("timestamp", 1).to_list(length=None) if project_ids else []
    heartbeat_stream = await db["heartbeat_stream"].find(
        {"metadata.project_id": {"$in": project_ids}},
        {"_id": 0, "timestamp": 1, "metadata.project_id": 1, "metadata.user_id": 1, "metadata.module": 1, "metadata.resource_id": 1},
    ).sort("timestamp", 1).to_list(length=None) if project_ids else []
    document_update_stream = await db["document_update_stream"].find(
        {"document_id": {"$in": document_ids}},
        {"_id": 1, "timestamp": 1, "document_id": 1, "room_id": 1, "user_id": 1, "operation_id": 1, "operation_type": 1, "client_id": 1, "payload_size": 1},
    ).sort("timestamp", 1).to_list(length=None) if document_ids else []

    heartbeat_sessions = _sessionize_heartbeats(heartbeat_stream, user_code_map)
    event_sequence = _build_event_sequence(
        chat_logs=chat_logs,
        research_events=research_events,
        activity_logs=activity_logs,
        resources=resources,
        documents=documents,
        doc_comments=doc_comments,
        tasks=tasks,
        wiki_items=wiki_items,
        inquiry_snapshots=inquiry_snapshots,
        ai_conversations=ai_conversations,
        ai_messages=ai_messages,
        heartbeat_sessions=heartbeat_sessions,
        user_code_map=user_code_map,
        project_name_map=project_name_map,
        project_condition_map=project_condition_map,
    )
    intervention_windows = _build_intervention_windows(event_sequence)

    return {
        "projects": projects,
        "project_ids": project_ids,
        "project_name_map": project_name_map,
        "project_condition_rows": project_condition_rows,
        "project_condition_map": project_condition_map,
        "users": users,
        "user_code_map": user_code_map,
        "chat_logs": chat_logs,
        "research_events": research_events,
        "learning_object_memories": learning_object_memories,
        "scaffold_round_memories": scaffold_round_memories,
        "activity_logs": activity_logs,
        "behavior_stream": behavior_stream,
        "heartbeat_stream": heartbeat_stream if include_raw_heartbeat else [],
        "raw_heartbeat_count": len(heartbeat_stream),
        "heartbeat_sessions": heartbeat_sessions,
        "resources": resources,
        "documents": documents,
        "doc_comments": doc_comments,
        "document_update_stream": document_update_stream,
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
    doc_comments: List[DocComment],
    tasks: List[Task],
    wiki_items: List[WikiItem],
    inquiry_snapshots: List[InquirySnapshot],
    ai_conversations: List[AIConversation],
    ai_messages: List[AIMessage],
    heartbeat_sessions: List[Dict[str, Any]],
    user_code_map: Dict[str, str],
    project_name_map: Dict[str, str],
    project_condition_map: Dict[str, Dict[str, Any]],
) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    conversation_by_id = {str(item.id): item for item in ai_conversations}
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
    document_project_map = {str(item.id): item.project_id for item in documents}
    for item in doc_comments:
        project_id = document_project_map.get(item.document_id, "")
        if not project_id:
            continue
        comment_text = " ".join(str(message.get("content") or "") for message in item.messages or [])
        events.append(_sequence_row(
            event_id=f"doc_comment:{item.id}",
            project_id=project_id,
            project_name=project_name_map.get(project_id, ""),
            user_id=item.created_by,
            actor_type="student",
            space="document",
            action="document_comment_update",
            object_type="doc_comment",
            object_id=str(item.id),
            timestamp=item.updated_at,
            content_length=len(comment_text),
            metadata={"document_id": item.document_id, "status": item.status},
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
    for item in inquiry_snapshots:
        events.append(_sequence_row(
            event_id=f"inquiry_snapshot:{item.id}",
            project_id=item.project_id,
            project_name=project_name_map.get(item.project_id, ""),
            user_id=item.created_by,
            actor_type="student" if item.created_by else "system",
            space="inquiry",
            action="inquiry_snapshot_save",
            object_type="inquiry_snapshot",
            object_id=str(item.id),
            timestamp=item.created_at,
            content_length=len(item.data or b""),
            metadata={"snapshot_version": item.snapshot_version, "snapshot_type": item.snapshot_type},
            user_code_map=user_code_map,
        ))
    for item in ai_messages:
        conversation = conversation_by_id.get(item.conversation_id)
        if not conversation:
            continue
        actor_type = "ai_tutor" if item.role == "assistant" else "student"
        row = _sequence_row(
            event_id=f"ai_message:{item.id}",
            project_id=conversation.project_id,
            project_name=project_name_map.get(conversation.project_id, ""),
            user_id=conversation.user_id if item.role == "user" else None,
            actor_type=actor_type,
            space="ai",
            action="ai_message_assistant" if item.role == "assistant" else "ai_message_user",
            object_type="ai_message",
            object_id=str(item.id),
            timestamp=item.created_at,
            content_length=len(item.content or ""),
            metadata={"conversation_id": item.conversation_id, "persona_id": conversation.persona_id, "category": conversation.category},
            user_code_map=user_code_map,
        )
        if item.role == "assistant":
            row["anonymous_id"] = "AI"
        events.append(row)
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
            "stage_label_zh": "",
            "content_length": 0,
            "semantic_tags": "presence",
            "ai_related": False,
            "teacher_related": False,
            "previous_event_id": "",
            "previous_action": "",
            "time_since_previous_seconds": "",
        })

    for event in events:
        event.update(_condition_event_fields(project_condition_map.get(event["project_id"])))

    events.sort(key=lambda row: (row["project_id"], row["timestamp"] or ""))
    active_stage_by_project: Dict[str, str] = {}
    for row in events:
        project_id = row["project_id"]
        condition = project_condition_map.get(project_id) or {}
        normalized_stage = _normalize_export_stage_id(
            row.get("stage_id"),
            active_stage_by_project.get(project_id) or condition.get("current_stage"),
        )
        row["stage_id"] = normalized_stage
        row["stage_label_zh"] = _export_stage_label(normalized_stage)
        active_stage_by_project[project_id] = normalized_stage

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
        "stage_id": _normalize_export_stage_id(stage_id) if stage_id else "",
        "stage_label_zh": _export_stage_label(stage_id) if stage_id else "",
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
                    "condition_label": event.get("condition_label", ""),
                    "group_condition": event.get("group_condition", ""),
                    "ai_scaffold_mode": event.get("ai_scaffold_mode", ""),
                    "process_scaffold_mode": event.get("process_scaffold_mode", ""),
                    "stage_control_mode": event.get("stage_control_mode", ""),
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


def _plain_text_from_html(html: Optional[str]) -> str:
    if not html:
        return ""
    text = re.sub(r"<(br|/p|/div|/li|/h[1-6])\b[^>]*>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _source_info(event_id: str) -> tuple[str, str]:
    prefix, _, source_id = event_id.partition(":")
    table_map = {
        "chat": "chat_logs",
        "research": "research_events",
        "activity": "activity_logs",
        "resource": "resources",
        "document": "documents",
        "doc_comment": "doc_comments",
        "task": "tasks",
        "wiki": "wiki_items",
        "presence": "heartbeat_sessions",
        "ai_message": "ai_messages",
        "inquiry_snapshot": "inquiry_snapshots",
    }
    return table_map.get(prefix, prefix), source_id


def _activity_label(space: str, action: str) -> str:
    labels = {
        "message_send": "发送小组消息",
        "ai_message_user": "向 AI 提问",
        "ai_message_assistant": "收到 AI 回复",
        "resource_upload": "上传资料",
        "document_update": "保存/更新文档",
        "document_comment_update": "更新文档批注",
        "inquiry_snapshot_save": "保存论证空间",
        "online_session": "在线会话",
    }
    if action in labels:
        return labels[action]
    if space == "task":
        return "更新/提交任务"
    if space == "wiki":
        return "更新知识沉淀"
    return action


def _content_ref_for_event(row: Dict[str, Any]) -> str:
    source_table, source_id = _source_info(row.get("event_id", ""))
    if not source_id:
        return ""
    if source_table == "chat_logs":
        return f"chat_{source_id}"
    if source_table == "ai_messages":
        return f"ai_{source_id}"
    if source_table == "documents":
        return f"doc_snapshot_{source_id}"
    if source_table == "doc_comments":
        return f"doc_comment_{source_id}"
    if source_table == "resources":
        return f"resource_{source_id}"
    if source_table == "wiki_items":
        return f"wiki_{source_id}"
    if source_table == "tasks":
        return f"task_{source_id}"
    if source_table == "inquiry_snapshots":
        return f"inquiry_snapshot_{source_id}"
    return ""


def _member_role_lookup(data: Dict[str, Any], user_code_map: Dict[str, str]) -> Dict[tuple[str, str], str]:
    roles: Dict[tuple[str, str], str] = {}
    for project in data["projects"]:
        project_id = str(project.id)
        if project.leader_id:
            roles[(project_id, _anonymize_user_id(project.leader_id, user_code_map))] = "leader"
        for member in project.members or []:
            anonymous_id = _anonymize_user_id(member.get("user_id"), user_code_map)
            roles[(project_id, anonymous_id)] = "leader" if member.get("user_id") == project.leader_id else (member.get("role") or "member")
    return roles


def _process_event_rows(data: Dict[str, Any], user_code_map: Dict[str, str]) -> List[Dict[str, Any]]:
    roles = _member_role_lookup(data, user_code_map)
    rows: List[Dict[str, Any]] = []
    for event in data["event_sequence"]:
        source_table, source_id = _source_info(event["event_id"])
        stage_id = _normalize_export_stage_id(event.get("stage_id"))
        actor_id = event.get("anonymous_id") or ("AI" if event.get("actor_type", "").startswith("ai") else "")
        rows.append({
            "case_id": event["project_id"],
            "subcase_id": f"{event['project_id']}::{stage_id}",
            "event_id": event["event_id"],
            "timestamp": event["timestamp"],
            "activity": event["action"],
            "activity_label_zh": _activity_label(event["space"], event["action"]),
            "actor_id": actor_id,
            "actor_type": event["actor_type"],
            "role_in_group": "ai" if actor_id == "AI" else roles.get((event["project_id"], actor_id), ""),
            "space": event["space"],
            "stage_id": stage_id,
            "stage_label_zh": _export_stage_label(stage_id),
            "object_type": event["object_type"],
            "object_id": event["object_id"],
            "content_ref": _content_ref_for_event(event),
            "content_length": event.get("content_length", 0),
            "source_table": source_table,
            "source_id": source_id,
            "previous_event_id": event.get("previous_event_id", ""),
            "previous_activity": event.get("previous_action", ""),
            "time_since_previous_sec": event.get("time_since_previous_seconds", ""),
            "is_ai_intervention": event.get("ai_related", False),
            "ai_role": event.get("actor_type", "") if event.get("ai_related") else "",
            "is_teacher_intervention": event.get("teacher_related", False),
            **_condition_event_fields(data["project_condition_map"].get(event["project_id"])),
        })
    return rows


def _balanced_process_event_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Keep all meaningful events while thinning repeated low-level operations."""
    kept: List[Dict[str, Any]] = []
    last_low_level: Dict[tuple[str, str, str, str, str], datetime] = {}
    protected_spaces = {"chat", "ai", "task"}
    protected_actions = {"resource_upload", "document_update", "document_comment_update", "inquiry_snapshot_save"}
    for row in rows:
        if row["space"] in protected_spaces or row["activity"] in protected_actions or row["is_ai_intervention"] or row["is_teacher_intervention"]:
            kept.append(row)
            continue
        timestamp = _datetime_or_none(row["timestamp"])
        key = (row["case_id"], row["actor_id"], row["space"], row["activity"])
        previous = last_low_level.get(key)
        if timestamp and previous and (timestamp - previous).total_seconds() < 60:
            continue
        if timestamp:
            last_low_level[key] = timestamp
        kept.append(row)
    return kept


def _event_object_link_rows(process_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows = []
    for row in process_rows:
        rows.append({
            "case_id": row["case_id"],
            "event_id": row["event_id"],
            "object_type": row["object_type"],
            "object_id": row["object_id"],
            "relation_type": row["activity"],
            "content_ref": row["content_ref"],
            "source_table": row["source_table"],
            "source_id": row["source_id"],
        })
    return rows


def _chat_transcript_rows(items: List[ChatLog], user_code_map: Dict[str, str]) -> List[Dict[str, Any]]:
    return [
        {
            "case_id": item.project_id,
            "event_id": f"chat:{item.id}",
            "content_ref": f"chat_{item.id}",
            "speaker_id": _anonymize_user_id(item.user_id, user_code_map),
            "speaker_type": "student" if item.message_type == "text" else item.message_type,
            "message_type": item.message_type,
            "message_text": item.content,
            "content_length": len(item.content or ""),
            "mentions": [_anonymize_user_id(user_id, user_code_map) for user_id in item.mentions or []],
            "metadata": item.metadata,
            "created_at": item.created_at,
        }
        for item in items
    ]


def _ai_transcript_rows(items: List[AIMessage], conversations: List[AIConversation], user_code_map: Dict[str, str]) -> List[Dict[str, Any]]:
    conversation_by_id = {str(item.id): item for item in conversations}
    rows = []
    for item in items:
        conversation = conversation_by_id.get(item.conversation_id)
        if not conversation:
            continue
        rows.append({
            "case_id": conversation.project_id,
            "event_id": f"ai_message:{item.id}",
            "content_ref": f"ai_{item.id}",
            "conversation_id": item.conversation_id,
            "actor_id": "AI" if item.role == "assistant" else _anonymize_user_id(conversation.user_id, user_code_map),
            "role": item.role,
            "persona_id": conversation.persona_id,
            "category": conversation.category,
            "message_text": item.content,
            "content_length": len(item.content or ""),
            "citations": item.citations,
            "metadata": item.metadata,
            "created_at": item.created_at,
        })
    return rows


def _document_snapshot_rows(items: List[Document], user_code_map: Dict[str, str]) -> List[Dict[str, Any]]:
    return [
        {
            "case_id": item.project_id,
            "event_id": f"document:{item.id}",
            "content_ref": f"doc_snapshot_{item.id}",
            "document_id": str(item.id),
            "title": item.title,
            "scope": getattr(item, "scope", None) or "shared",
            "owner_id": _anonymize_user_id(getattr(item, "owner_id", None) or item.last_modified_by, user_code_map),
            "last_modified_by": _anonymize_user_id(item.last_modified_by, user_code_map),
            "plain_text": _plain_text_from_html(item.content),
            "html": item.content or "",
            "content_length": len(_plain_text_from_html(item.content)),
            "source_type": item.source_type,
            "course_task_release_id": item.course_task_release_id,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
        }
        for item in items
    ]


def _document_comment_rows(items: List[DocComment], document_project_map: Dict[str, str], user_code_map: Dict[str, str]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for item in items:
        project_id = document_project_map.get(item.document_id, "")
        if not project_id:
            continue
        messages = item.messages or [{"user_id": item.created_by, "content": "", "created_at": item.created_at}]
        for index, message in enumerate(messages):
            rows.append({
                "case_id": project_id,
                "event_id": f"doc_comment:{item.id}",
                "content_ref": f"doc_comment_{item.id}" if index == 0 else f"doc_comment_{item.id}_{index + 1}",
                "comment_id": str(item.id),
                "document_id": item.document_id,
                "message_index": index + 1,
                "author_id": _anonymize_user_id(message.get("user_id") or item.created_by, user_code_map),
                "comment_text": message.get("content") or "",
                "status": item.status,
                "anchor_context": item.anchor_context,
                "mentioned_user_ids": [_anonymize_user_id(user_id, user_code_map) for user_id in item.mentioned_user_ids or []],
                "created_at": message.get("created_at") or item.created_at,
                "updated_at": item.updated_at,
            })
    return rows


def _document_update_operation_rows(
    items: List[Dict[str, Any]],
    document_project_map: Dict[str, str],
    user_code_map: Dict[str, str],
    fallback_events: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for item in items:
        document_id = item.get("document_id")
        project_id = document_project_map.get(document_id, "")
        if not project_id:
            continue
        source_id = str(item.get("_id") or item.get("operation_id") or "")
        rows.append({
            "case_id": project_id,
            "event_id": f"document_update_op:{source_id}",
            "content_ref": f"doc_update_{source_id}",
            "document_id": document_id,
            "actor_id": _anonymize_user_id(item.get("user_id"), user_code_map),
            "source_granularity": "yjs_realtime_update",
            "operation_type": item.get("operation_type"),
            "operation_id": item.get("operation_id"),
            "client_id": item.get("client_id"),
            "payload_size": item.get("payload_size"),
            "content_length": "",
            "timestamp": item.get("timestamp"),
            "analysis_note": "实时协同编辑 Yjs 更新索引，可用于写作密度和共同编辑时序分析；不直接暴露二进制更新正文。",
        })
    seen_event_ids = {row["event_id"] for row in rows}
    for event in fallback_events or []:
        if event.get("space") not in {"document", "shared_record"}:
            continue
        if event.get("action") not in {
            "document_update",
            "document_comment_update",
            "shared_record_save",
            "shared_record_content_commit",
            "shared_record_annotation_create",
            "shared_record_annotation_reply",
            "shared_record_annotation_resolve",
        }:
            continue
        event_id = f"document_save_event:{event.get('event_id')}"
        if event_id in seen_event_ids:
            continue
        rows.append({
            "case_id": event.get("project_id", ""),
            "event_id": event_id,
            "content_ref": _content_ref_for_event(event),
            "document_id": event.get("object_id", "") if event.get("object_type") == "document" else "",
            "actor_id": event.get("anonymous_id", ""),
            "source_granularity": "save_or_commit_event",
            "operation_type": event.get("action", ""),
            "operation_id": event.get("event_id", ""),
            "client_id": "",
            "payload_size": "",
            "content_length": event.get("content_length", 0),
            "timestamp": event.get("timestamp", ""),
            "analysis_note": "旧数据回填的保存/提交级写作事件，只能分析文档保存、提交和批注时序，不能解释为逐字实时编辑。",
        })
        seen_event_ids.add(event_id)
    return rows


def _resource_manifest_rows(items: List[Resource], user_code_map: Dict[str, str]) -> List[Dict[str, Any]]:
    return [
        {
            "case_id": item.project_id or "",
            "event_id": f"resource:{item.id}" if item.project_id else "",
            "content_ref": f"resource_{item.id}",
            "resource_id": str(item.id),
            "filename": item.filename,
            "size": item.size,
            "mime_type": item.mime_type,
            "source_type": item.source_type,
            "uploaded_by": _anonymize_user_id(item.uploaded_by, user_code_map),
            "uploaded_at": item.uploaded_at,
            "parse_status": item.parse_status,
            "parsed_markdown_available": bool(item.parsed_markdown_key),
            "parsed_content_available": bool(item.parsed_content_key),
        }
        for item in items
    ]


def _inquiry_object_rows(items: List[InquirySnapshot], user_code_map: Dict[str, str]) -> List[Dict[str, Any]]:
    return [
        {
            "case_id": item.project_id,
            "event_id": f"inquiry_snapshot:{item.id}",
            "content_ref": f"inquiry_snapshot_{item.id}",
            "snapshot_id": str(item.id),
            "snapshot_version": item.snapshot_version,
            "snapshot_type": item.snapshot_type,
            "data_size": len(item.data or b""),
            "compressed": item.compressed,
            "created_by": _anonymize_user_id(item.created_by, user_code_map),
            "created_at": item.created_at,
            "analysis_note": "当前导出保留快照锚点和大小；节点/边解析可在后续版本中从 Yjs 快照解码后补充。",
        }
        for item in items
    ]


def _research_package_readme() -> str:
    return """AISCL 班级研究数据包

推荐分析路径：
1. 先查看 01_class_index/，确认班级、小组、成员匿名编号和实验条件。
2. 以 02_groups/{group}/process/process_event_log_full.csv 作为小组过程挖掘主表。
3. 若需要降低高频低层操作影响，使用 process_event_log_balanced.csv。
4. 通过 event_id、content_ref、source_table/source_id 将 process 表与 content 表对齐。
5. 03_comparative_analysis/ 用于跨小组比较，不能替代小组内过程分析。

研究单位说明：
- course 是实验场域。
- group/project 是主要 case。
- student 是嵌套在小组内的个体。
- event 是过程挖掘和行为链分析的最小单位。

解释边界：
- 心跳已经默认会话化，表示在线机会，不直接代表有效参与。
- 文档快照表示保存时的阶段性文本，不等同于逐字编辑记录。
- AI/教师介入后的响应需结合 intervention_windows 和 content 表人工复核。
"""


def _write_researcher_oriented_package(archive: zipfile.ZipFile, course: Course, data: Dict[str, Any], user_code_map: Dict[str, str]) -> None:
    process_rows = _process_event_rows(data, user_code_map)
    balanced_rows = _balanced_process_event_rows(process_rows)
    link_rows = _event_object_link_rows(process_rows)
    document_project_map = {str(item.id): item.project_id for item in data["documents"]}
    chat_rows = _chat_transcript_rows(data["chat_logs"], user_code_map)
    ai_rows = _ai_transcript_rows(data["ai_messages"], data["ai_conversations"], user_code_map)
    document_rows = _document_snapshot_rows(data["documents"], user_code_map)
    comment_rows = _document_comment_rows(data["doc_comments"], document_project_map, user_code_map)
    document_update_rows = _document_update_operation_rows(
        data["document_update_stream"],
        document_project_map,
        user_code_map,
        data["event_sequence"],
    )
    resource_rows = _resource_manifest_rows(data["resources"], user_code_map)
    inquiry_rows = _inquiry_object_rows(data["inquiry_snapshots"], user_code_map)

    archive.writestr("00_README/README.md", _research_package_readme().encode("utf-8"))
    _write_csv(archive, "00_README/data_dictionary.csv", _data_dictionary_rows(), ["file", "field", "meaning", "analysis_note"])
    _write_csv(archive, "00_README/event_codebook.csv", _behavior_codebook_rows(), ["space", "action", "analysis_use", "interpretation_note"])
    archive.writestr(
        "00_README/export_manifest.json",
        json.dumps({
            "exported_at": utc_isoformat(datetime.utcnow()),
            "course_id": str(course.id),
            "course_name": course.name,
            "main_case_unit": "group/project",
            "primary_process_table": "02_groups/{group}/process/process_event_log_full.csv",
            "balanced_process_table": "02_groups/{group}/process/process_event_log_balanced.csv",
            "alignment_keys": ["event_id", "content_ref", "source_table", "source_id", "object_id"],
        }, ensure_ascii=False, indent=2).encode("utf-8"),
    )

    _write_csv(archive, "01_class_index/course_info.csv", [{
        "course_id": str(course.id),
        "course_name": course.name,
        "semester": course.semester,
        "teacher_id": _anonymize_user_id(course.teacher_id, user_code_map),
        "student_count": len(course.students or []),
        "project_count": len(data["projects"]),
        "created_at": course.created_at,
        "updated_at": course.updated_at,
    }], ["course_id", "course_name", "semester", "teacher_id", "student_count", "project_count", "created_at", "updated_at"])
    _write_csv(archive, "01_class_index/group_conditions.csv", data["project_condition_rows"], CONDITION_FIELDNAMES)
    _write_csv(archive, "01_class_index/group_members.csv", _group_member_rows(data, user_code_map), ["project_id", "project_name", "anonymous_id", "project_role", "is_leader", "joined_at"])
    _write_csv(archive, "01_class_index/group_summary.csv", _group_summary_rows(data["project_ids"], data["event_sequence"], data["heartbeat_sessions"], data), GROUP_SUMMARY_FIELDNAMES)
    _write_csv(archive, "01_class_index/student_summary.csv", _student_summary_rows(data["event_sequence"], data["heartbeat_sessions"], data), STUDENT_SUMMARY_FIELDNAMES)

    _write_csv(archive, "03_comparative_analysis/all_groups_process_event_log_full.csv", process_rows, PROCESS_EVENT_LOG_FIELDNAMES)
    _write_csv(archive, "03_comparative_analysis/all_groups_process_event_log_balanced.csv", balanced_rows, PROCESS_EVENT_LOG_FIELDNAMES)
    _write_csv(archive, "03_comparative_analysis/all_groups_event_object_links.csv", link_rows, EVENT_OBJECT_LINK_FIELDNAMES)
    _write_csv(archive, "03_comparative_analysis/group_stage_summary.csv", _group_stage_summary_rows(data["project_ids"], data["event_sequence"], data["heartbeat_sessions"], data), GROUP_STAGE_SUMMARY_FIELDNAMES)
    _write_csv(archive, "03_comparative_analysis/intervention_exposure.csv", _intervention_exposure_rows(data["project_ids"], data["event_sequence"], data), INTERVENTION_EXPOSURE_FIELDNAMES)

    for project_id in data["project_ids"]:
        group_dir = f"02_groups/{_group_dir_name(project_id, data['project_name_map'])}"
        _write_csv(archive, f"{group_dir}/metadata/group_info.csv", [row for row in _group_rows(data, user_code_map) if row["project_id"] == project_id], ["project_id", "project_name", "course_id", "condition_label", "group_condition", "ai_scaffold_mode", "process_scaffold_mode", "stage_control_mode", "leader_anonymous_id", "member_count", "is_archived", "created_at", "updated_at"])
        _write_csv(archive, f"{group_dir}/metadata/members.csv", [row for row in _group_member_rows(data, user_code_map) if row["project_id"] == project_id], ["project_id", "project_name", "anonymous_id", "project_role", "is_leader", "joined_at"])
        _write_csv(archive, f"{group_dir}/metadata/condition.csv", [data["project_condition_map"].get(project_id, {})], CONDITION_FIELDNAMES)
        group_process = [row for row in process_rows if row["case_id"] == project_id]
        _write_csv(archive, f"{group_dir}/process/process_event_log_full.csv", group_process, PROCESS_EVENT_LOG_FIELDNAMES)
        _write_csv(archive, f"{group_dir}/process/process_event_log_balanced.csv", [row for row in balanced_rows if row["case_id"] == project_id], PROCESS_EVENT_LOG_FIELDNAMES)
        _write_csv(archive, f"{group_dir}/process/event_object_links.csv", [row for row in link_rows if row["case_id"] == project_id], EVENT_OBJECT_LINK_FIELDNAMES)
        _write_csv(archive, f"{group_dir}/process/intervention_windows.csv", [row for row in data["intervention_windows"] if row["project_id"] == project_id], INTERVENTION_WINDOW_FIELDNAMES)
        _write_csv(archive, f"{group_dir}/content/chat_transcript.csv", [row for row in chat_rows if row["case_id"] == project_id], CHAT_TRANSCRIPT_FIELDNAMES)
        _write_csv(archive, f"{group_dir}/content/ai_transcript.csv", [row for row in ai_rows if row["case_id"] == project_id], AI_TRANSCRIPT_FIELDNAMES)
        _write_csv(archive, f"{group_dir}/content/document_snapshots.csv", [row for row in document_rows if row["case_id"] == project_id], DOCUMENT_SNAPSHOT_FIELDNAMES)
        _write_csv(archive, f"{group_dir}/content/document_comments.csv", [row for row in comment_rows if row["case_id"] == project_id], DOCUMENT_COMMENT_FIELDNAMES)
        _write_csv(archive, f"{group_dir}/content/document_update_operations.csv", [row for row in document_update_rows if row["case_id"] == project_id], DOCUMENT_UPDATE_OPERATION_FIELDNAMES)
        _write_csv(archive, f"{group_dir}/content/inquiry_objects.csv", [row for row in inquiry_rows if row["case_id"] == project_id], INQUIRY_OBJECT_FIELDNAMES)
        _write_csv(archive, f"{group_dir}/content/wiki_items.csv", [row for row in _wiki_item_rows(data["wiki_items"], user_code_map) if row["project_id"] == project_id], ["id", "project_id", "stage_id", "item_type", "title", "content", "summary", "source_type", "created_by", "updated_by", "confidence_level", "created_at", "updated_at"])
        _write_csv(archive, f"{group_dir}/content/task_submissions.csv", [row for row in _task_rows(data["tasks"], user_code_map) if row["project_id"] == project_id], ["id", "project_id", "title", "column", "source_type", "course_task_release_id", "submission_status", "submitted_by", "submitted_at", "review_status", "created_at", "updated_at"])
        _write_csv(archive, f"{group_dir}/content/resource_manifest.csv", [row for row in resource_rows if row["case_id"] == project_id], RESOURCE_MANIFEST_FIELDNAMES)


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
                    "structure": [
                        "00_README",
                        "01_class_index",
                        "02_groups",
                        "03_comparative_analysis",
                        "metadata",
                        "raw",
                        "cleaned",
                        "analysis_ready",
                        "all_groups",
                        "groups",
                        "files",
                    ],
                    "primary_structure": "Use 00_README, 01_class_index, 02_groups, and 03_comparative_analysis for research analysis. Legacy folders are retained for compatibility.",
                    "main_case_unit": "group/project",
                    "alignment_keys": ["event_id", "content_ref", "source_table", "source_id", "object_id"],
                    "analysis_ready_files": [
                        "event_sequence.csv",
                        "intervention_windows.csv",
                        "group_summary.csv",
                        "student_summary.csv",
                        "group_stage_summary.csv",
                        "intervention_exposure.csv",
                    ],
                    "group_split": "Per-group copies are written under groups/{project_id_prefix}_{project_name}/ for analysis without manual filtering.",
                },
                ensure_ascii=False,
                indent=2,
            ).encode("utf-8"),
        )
        _write_researcher_oriented_package(archive, course, data, user_code_map)
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
        _write_csv(archive, "metadata/group_conditions.csv", data["project_condition_rows"], CONDITION_FIELDNAMES)

        _write_csv(archive, "raw/groups.csv", [
            {
                "project_id": str(project.id),
                "project_name": project.name,
                "course_id": project.course_id,
                **_condition_event_fields(data["project_condition_map"].get(str(project.id))),
                "leader_anonymous_id": _anonymize_user_id(project.leader_id, user_code_map),
                "member_count": len(project.members or []),
                "is_archived": project.is_archived,
                "created_at": project.created_at,
                "updated_at": project.updated_at,
            }
            for project in data["projects"]
        ], ["project_id", "project_name", "course_id", "condition_label", "group_condition", "ai_scaffold_mode", "process_scaffold_mode", "stage_control_mode", "leader_anonymous_id", "member_count", "is_archived", "created_at", "updated_at"])
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
                "stage_id": _normalize_export_stage_id(item.stage_id),
                "sequence_index": item.sequence_index,
                "payload": item.payload,
                "event_time": item.event_time,
                "created_at": item.created_at,
            }
            for item in data["research_events"]
        ], ["id", "project_id", "group_id", "anonymous_id", "actor_type", "event_domain", "event_type", "stage_id", "sequence_index", "payload", "event_time", "created_at"])
        _write_csv(archive, "raw/learning_object_memories.csv", _learning_object_memory_rows(data["learning_object_memories"], user_code_map), LEARNING_OBJECT_MEMORY_FIELDNAMES)
        _write_csv(archive, "raw/scaffold_round_memories.csv", _scaffold_round_memory_rows(data["scaffold_round_memories"]), SCAFFOLD_ROUND_MEMORY_FIELDNAMES)
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
            *EVENT_SEQUENCE_FIELDNAMES
        ])
        _write_csv(archive, "analysis_ready/intervention_windows.csv", data["intervention_windows"], [
            *INTERVENTION_WINDOW_FIELDNAMES
        ])
        _write_summary_csvs(archive, data)
        _write_group_split_package(archive, data, user_code_map)

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
            "scope": getattr(item, "scope", None) or "shared",
            "owner_id": _anonymize_user_id(getattr(item, "owner_id", None) or item.last_modified_by, user_code_map),
            "last_modified_by": _anonymize_user_id(item.last_modified_by, user_code_map),
            "is_archived": item.is_archived,
            "source_type": item.source_type,
            "course_task_release_id": item.course_task_release_id,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
        }
        for item in data["documents"]
    ], ["id", "project_id", "title", "content_text_length", "scope", "owner_id", "last_modified_by", "is_archived", "source_type", "course_task_release_id", "created_at", "updated_at"])
    _write_csv(archive, "raw/wiki_items.csv", [
        {
            "id": str(item.id),
            "project_id": item.project_id,
            "stage_id": _normalize_export_stage_id(item.stage_id),
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
    conversation_project_map = {str(item.id): item.project_id for item in data["ai_conversations"]}
    _write_csv(
        archive,
        "raw/ai_messages.csv",
        _ai_message_rows(data["ai_messages"], conversation_project_map),
        ["id", "project_id", "conversation_id", "role", "content", "content_length", "citations", "metadata", "created_at"],
    )
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
    group_rows = _group_summary_rows(project_ids, sequence, sessions, data)
    student_rows = _student_summary_rows(sequence, sessions, data)
    group_stage_rows = _group_stage_summary_rows(project_ids, sequence, sessions, data)
    intervention_exposure_rows = _intervention_exposure_rows(project_ids, sequence, data)
    _write_csv(archive, "analysis_ready/group_summary.csv", group_rows, GROUP_SUMMARY_FIELDNAMES)
    _write_csv(archive, "analysis_ready/student_summary.csv", student_rows, STUDENT_SUMMARY_FIELDNAMES)
    _write_csv(archive, "analysis_ready/group_stage_summary.csv", group_stage_rows, GROUP_STAGE_SUMMARY_FIELDNAMES)
    _write_csv(archive, "analysis_ready/intervention_exposure.csv", intervention_exposure_rows, INTERVENTION_EXPOSURE_FIELDNAMES)


def _project_summary_context(project_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "project_id": project_id,
        "project_name": data["project_name_map"].get(project_id, ""),
        **_condition_event_fields(data["project_condition_map"].get(project_id)),
    }


def _group_summary_rows(project_ids: List[str], sequence: List[Dict[str, Any]], sessions: List[Dict[str, Any]], data: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [
        {
            **_project_summary_context(project_id, data),
            "event_count": sum(1 for row in sequence if row["project_id"] == project_id),
            "chat_count": sum(1 for row in sequence if row["project_id"] == project_id and row["space"] == "chat"),
            "artifact_event_count": sum(1 for row in sequence if row["project_id"] == project_id and "artifact_construction" in row["semantic_tags"]),
            "ai_related_count": sum(1 for row in sequence if row["project_id"] == project_id and row["ai_related"]),
            "teacher_related_count": sum(1 for row in sequence if row["project_id"] == project_id and row["teacher_related"]),
            "online_session_minutes": round(sum(int(row["duration_seconds"]) for row in sessions if row["project_id"] == project_id) / 60, 2),
        }
        for project_id in project_ids
    ]


def _student_summary_rows(sequence: List[Dict[str, Any]], sessions: List[Dict[str, Any]], data: Dict[str, Any]) -> List[Dict[str, Any]]:
    pairs = sorted({(row["project_id"], row["anonymous_id"]) for row in sequence if row.get("anonymous_id")})
    return [
        {
            **_project_summary_context(project_id, data),
            "anonymous_id": anonymous_id,
            "event_count": sum(1 for row in sequence if row["project_id"] == project_id and row["anonymous_id"] == anonymous_id),
            "chat_count": sum(1 for row in sequence if row["project_id"] == project_id and row["anonymous_id"] == anonymous_id and row["space"] == "chat"),
            "resource_event_count": sum(1 for row in sequence if row["project_id"] == project_id and row["anonymous_id"] == anonymous_id and row["space"] == "resource"),
            "artifact_event_count": sum(1 for row in sequence if row["project_id"] == project_id and row["anonymous_id"] == anonymous_id and "artifact_construction" in row["semantic_tags"]),
            "online_session_minutes": round(sum(int(row["duration_seconds"]) for row in sessions if row["project_id"] == project_id and row["anonymous_id"] == anonymous_id) / 60, 2),
        }
        for project_id, anonymous_id in pairs
    ]


def _group_stage_summary_rows(project_ids: List[str], sequence: List[Dict[str, Any]], sessions: List[Dict[str, Any]], data: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for project_id in project_ids:
        stages = sorted(
            {_normalize_export_stage_id(row.get("stage_id")) for row in sequence if row["project_id"] == project_id},
            key=lambda stage: CURRENT_EXPORT_STAGE_SEQUENCE.index(stage),
        )
        if not stages:
            stages = ["problem_construction"]
        for stage_id in stages:
            scoped = [row for row in sequence if row["project_id"] == project_id and _normalize_export_stage_id(row.get("stage_id")) == stage_id]
            rows.append({
                **_project_summary_context(project_id, data),
                "stage_id": stage_id,
                "stage_label_zh": _export_stage_label(stage_id),
                "event_count": len(scoped),
                "chat_count": sum(1 for row in scoped if row["space"] == "chat"),
                "student_turn_count": sum(1 for row in scoped if row["space"] == "chat" and row["actor_type"] == "student"),
                "ai_prompt_count": sum(1 for row in scoped if row["ai_related"]),
                "teacher_support_count": sum(1 for row in scoped if row["teacher_related"]),
                "evidence_event_count": sum(1 for row in scoped if "evidence_use" in row["semantic_tags"]),
                "challenge_event_count": sum(1 for row in scoped if "critical_challenge" in row["semantic_tags"]),
                "artifact_event_count": sum(1 for row in scoped if "artifact_construction" in row["semantic_tags"]),
                "resource_event_count": sum(1 for row in scoped if row["space"] == "resource"),
                "document_update_count": sum(1 for row in scoped if row["space"] == "document"),
                "wiki_update_count": sum(1 for row in scoped if row["space"] == "wiki"),
                "online_session_minutes": round(sum(int(row["duration_seconds"]) for row in sessions if row["project_id"] == project_id) / 60, 2),
            })
    return rows


def _intervention_exposure_rows(project_ids: List[str], sequence: List[Dict[str, Any]], data: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for project_id in project_ids:
        scoped = [row for row in sequence if row["project_id"] == project_id]
        interventions = [row for row in scoped if row.get("ai_related") or row.get("teacher_related")]
        buckets = sorted({(
            "ai" if row.get("ai_related") else "teacher",
            row.get("actor_type") or "",
            _normalize_export_stage_id(row.get("stage_id")),
        ) for row in interventions})
        for source, agent_role, stage_id in buckets:
            selected = [
                row for row in interventions
                if ("ai" if row.get("ai_related") else "teacher") == source
                and (row.get("actor_type") or "") == agent_role
                and _normalize_export_stage_id(row.get("stage_id")) == stage_id
            ]
            first_time = min((row["timestamp"] for row in selected if row.get("timestamp")), default="")
            last_time = max((row["timestamp"] for row in selected if row.get("timestamp")), default="")
            rows.append({
                **_project_summary_context(project_id, data),
                "intervention_source": source,
                "agent_role": agent_role,
                "stage_id": stage_id,
                "stage_label_zh": _export_stage_label(stage_id),
                "intervention_count": len(selected),
                "first_intervention_at": first_time,
                "last_intervention_at": last_time,
                "student_followup_count_5min": _count_followups_after_interventions(selected, scoped, 5 * 60),
                "student_followup_count_30min": _count_followups_after_interventions(selected, scoped, 30 * 60),
            })
    return rows


def _count_followups_after_interventions(interventions: List[Dict[str, Any]], events: List[Dict[str, Any]], max_seconds: int) -> int:
    count = 0
    for intervention in interventions:
        for event in events:
            if event["event_id"] == intervention["event_id"] or event.get("actor_type") != "student":
                continue
            lag_seconds = _seconds_between_iso(intervention.get("timestamp") or "", event.get("timestamp") or "")
            if lag_seconds and 0 < int(lag_seconds) <= max_seconds:
                count += 1
    return count


def _write_group_split_package(archive: zipfile.ZipFile, data: Dict[str, Any], user_code_map: Dict[str, str]) -> None:
    """Write analysis-friendly all-group copies and per-group split tables."""
    conversation_project_map = {str(item.id): item.project_id for item in data["ai_conversations"]}
    _write_csv(archive, "all_groups/metadata/group_conditions.csv", data["project_condition_rows"], CONDITION_FIELDNAMES)
    _write_csv(archive, "all_groups/raw/groups.csv", _group_rows(data, user_code_map), ["project_id", "project_name", "course_id", "condition_label", "group_condition", "ai_scaffold_mode", "process_scaffold_mode", "stage_control_mode", "leader_anonymous_id", "member_count", "is_archived", "created_at", "updated_at"])
    _write_csv(archive, "all_groups/raw/group_members.csv", _group_member_rows(data, user_code_map), ["project_id", "project_name", "anonymous_id", "project_role", "is_leader", "joined_at"])
    _write_csv(archive, "all_groups/raw/chat_logs.csv", _chat_log_rows(data["chat_logs"], user_code_map), ["id", "project_id", "anonymous_id", "message_type", "content", "content_length", "mentions", "metadata", "created_at"])
    _write_csv(archive, "all_groups/raw/research_events.csv", _research_event_rows(data["research_events"], user_code_map), ["id", "project_id", "group_id", "anonymous_id", "actor_type", "event_domain", "event_type", "stage_id", "sequence_index", "payload", "event_time", "created_at"])
    _write_csv(archive, "all_groups/raw/learning_object_memories.csv", _learning_object_memory_rows(data["learning_object_memories"], user_code_map), LEARNING_OBJECT_MEMORY_FIELDNAMES)
    _write_csv(archive, "all_groups/raw/scaffold_round_memories.csv", _scaffold_round_memory_rows(data["scaffold_round_memories"]), SCAFFOLD_ROUND_MEMORY_FIELDNAMES)
    _write_csv(archive, "all_groups/raw/activity_logs.csv", _activity_log_rows(data["activity_logs"], user_code_map), ["id", "project_id", "anonymous_id", "module", "action", "target_id", "duration", "metadata", "timestamp"])
    _write_csv(archive, "all_groups/raw/behavior_stream.csv", _behavior_stream_rows(data["behavior_stream"], user_code_map), ["timestamp", "project_id", "anonymous_id", "module", "action"])
    if data["heartbeat_stream"]:
        _write_csv(archive, "all_groups/raw/heartbeat_stream.csv", _heartbeat_stream_rows(data["heartbeat_stream"], user_code_map), ["timestamp", "project_id", "anonymous_id", "module", "resource_id"])
    _write_csv(archive, "all_groups/raw/resources.csv", _resource_rows(data["resources"], user_code_map), ["id", "project_id", "course_id", "scope", "filename", "file_key", "size", "mime_type", "source_type", "uploaded_by", "uploaded_at", "parse_status"])
    _write_csv(archive, "all_groups/raw/documents.csv", _document_rows(data["documents"], user_code_map), ["id", "project_id", "title", "content_text_length", "scope", "owner_id", "last_modified_by", "is_archived", "source_type", "course_task_release_id", "created_at", "updated_at"])
    _write_csv(archive, "all_groups/raw/wiki_items.csv", _wiki_item_rows(data["wiki_items"], user_code_map), ["id", "project_id", "stage_id", "item_type", "title", "content", "summary", "source_type", "created_by", "updated_by", "confidence_level", "created_at", "updated_at"])
    _write_csv(archive, "all_groups/raw/tasks.csv", _task_rows(data["tasks"], user_code_map), ["id", "project_id", "title", "column", "source_type", "course_task_release_id", "submission_status", "submitted_by", "submitted_at", "review_status", "created_at", "updated_at"])
    _write_csv(archive, "all_groups/raw/ai_conversations.csv", _ai_conversation_rows(data["ai_conversations"], user_code_map), ["id", "project_id", "anonymous_id", "persona_id", "title", "category", "created_at", "updated_at"])
    _write_csv(archive, "all_groups/raw/ai_messages.csv", _ai_message_rows(data["ai_messages"], conversation_project_map), ["id", "project_id", "conversation_id", "role", "content", "content_length", "citations", "metadata", "created_at"])
    _write_csv(archive, "all_groups/cleaned/heartbeat_sessions.csv", data["heartbeat_sessions"], [
        "session_id", "project_id", "anonymous_id", "start_time", "end_time", "duration_seconds", "heartbeat_count", "active_modules", "resource_ids", "overlap_ready"
    ])
    _write_csv(archive, "all_groups/analysis_ready/event_sequence.csv", data["event_sequence"], EVENT_SEQUENCE_FIELDNAMES)
    _write_csv(archive, "all_groups/analysis_ready/intervention_windows.csv", data["intervention_windows"], INTERVENTION_WINDOW_FIELDNAMES)
    _write_csv(archive, "all_groups/analysis_ready/group_summary.csv", _group_summary_rows(data["project_ids"], data["event_sequence"], data["heartbeat_sessions"], data), GROUP_SUMMARY_FIELDNAMES)
    _write_csv(archive, "all_groups/analysis_ready/student_summary.csv", _student_summary_rows(data["event_sequence"], data["heartbeat_sessions"], data), STUDENT_SUMMARY_FIELDNAMES)
    _write_csv(archive, "all_groups/analysis_ready/group_stage_summary.csv", _group_stage_summary_rows(data["project_ids"], data["event_sequence"], data["heartbeat_sessions"], data), GROUP_STAGE_SUMMARY_FIELDNAMES)
    _write_csv(archive, "all_groups/analysis_ready/intervention_exposure.csv", _intervention_exposure_rows(data["project_ids"], data["event_sequence"], data), INTERVENTION_EXPOSURE_FIELDNAMES)

    for project_id in data["project_ids"]:
        group_dir = f"groups/{_group_dir_name(project_id, data['project_name_map'])}"
        _write_csv(archive, f"{group_dir}/metadata/group_condition.csv", [data["project_condition_map"].get(project_id, {})], CONDITION_FIELDNAMES)
        _write_csv(archive, f"{group_dir}/raw/group_members.csv", [row for row in _group_member_rows(data, user_code_map) if row["project_id"] == project_id], ["project_id", "project_name", "anonymous_id", "project_role", "is_leader", "joined_at"])
        _write_csv(
            archive,
            f"{group_dir}/raw/chat_logs.csv",
            _chat_log_rows([item for item in data["chat_logs"] if item.project_id == project_id], user_code_map),
            ["id", "project_id", "anonymous_id", "message_type", "content", "content_length", "mentions", "metadata", "created_at"],
        )
        _write_csv(
            archive,
            f"{group_dir}/raw/research_events.csv",
            _research_event_rows([item for item in data["research_events"] if item.project_id == project_id], user_code_map),
            ["id", "project_id", "group_id", "anonymous_id", "actor_type", "event_domain", "event_type", "stage_id", "sequence_index", "payload", "event_time", "created_at"],
        )
        _write_csv(
            archive,
            f"{group_dir}/raw/learning_object_memories.csv",
            _learning_object_memory_rows([item for item in data["learning_object_memories"] if item.project_id == project_id], user_code_map),
            LEARNING_OBJECT_MEMORY_FIELDNAMES,
        )
        _write_csv(
            archive,
            f"{group_dir}/raw/scaffold_round_memories.csv",
            _scaffold_round_memory_rows([item for item in data["scaffold_round_memories"] if item.project_id == project_id]),
            SCAFFOLD_ROUND_MEMORY_FIELDNAMES,
        )
        _write_csv(
            archive,
            f"{group_dir}/raw/activity_logs.csv",
            _activity_log_rows([item for item in data["activity_logs"] if item.project_id == project_id], user_code_map),
            ["id", "project_id", "anonymous_id", "module", "action", "target_id", "duration", "metadata", "timestamp"],
        )
        _write_csv(
            archive,
            f"{group_dir}/raw/resources.csv",
            _resource_rows([item for item in data["resources"] if item.project_id == project_id], user_code_map),
            ["id", "project_id", "course_id", "scope", "filename", "file_key", "size", "mime_type", "source_type", "uploaded_by", "uploaded_at", "parse_status"],
        )
        _write_csv(
            archive,
            f"{group_dir}/raw/documents.csv",
            _document_rows([item for item in data["documents"] if item.project_id == project_id], user_code_map),
            ["id", "project_id", "title", "content_text_length", "scope", "owner_id", "last_modified_by", "is_archived", "source_type", "course_task_release_id", "created_at", "updated_at"],
        )
        _write_csv(
            archive,
            f"{group_dir}/raw/wiki_items.csv",
            _wiki_item_rows([item for item in data["wiki_items"] if item.project_id == project_id], user_code_map),
            ["id", "project_id", "stage_id", "item_type", "title", "content", "summary", "source_type", "created_by", "updated_by", "confidence_level", "created_at", "updated_at"],
        )
        _write_csv(
            archive,
            f"{group_dir}/raw/tasks.csv",
            _task_rows([item for item in data["tasks"] if item.project_id == project_id], user_code_map),
            ["id", "project_id", "title", "column", "source_type", "course_task_release_id", "submission_status", "submitted_by", "submitted_at", "review_status", "created_at", "updated_at"],
        )
        group_conversation_ids = {str(item.id) for item in data["ai_conversations"] if item.project_id == project_id}
        _write_csv(
            archive,
            f"{group_dir}/raw/ai_conversations.csv",
            _ai_conversation_rows([item for item in data["ai_conversations"] if item.project_id == project_id], user_code_map),
            ["id", "project_id", "anonymous_id", "persona_id", "title", "category", "created_at", "updated_at"],
        )
        _write_csv(
            archive,
            f"{group_dir}/raw/ai_messages.csv",
            _ai_message_rows([item for item in data["ai_messages"] if item.conversation_id in group_conversation_ids], conversation_project_map),
            ["id", "project_id", "conversation_id", "role", "content", "content_length", "citations", "metadata", "created_at"],
        )
        group_sequence = [row for row in data["event_sequence"] if row["project_id"] == project_id]
        group_sessions = [row for row in data["heartbeat_sessions"] if row["project_id"] == project_id]
        _write_csv(archive, f"{group_dir}/cleaned/heartbeat_sessions.csv", group_sessions, [
            "session_id", "project_id", "anonymous_id", "start_time", "end_time", "duration_seconds", "heartbeat_count", "active_modules", "resource_ids", "overlap_ready"
        ])
        _write_csv(archive, f"{group_dir}/analysis_ready/event_sequence.csv", group_sequence, EVENT_SEQUENCE_FIELDNAMES)
        _write_csv(archive, f"{group_dir}/analysis_ready/intervention_windows.csv", [row for row in data["intervention_windows"] if row["project_id"] == project_id], INTERVENTION_WINDOW_FIELDNAMES)
        _write_csv(archive, f"{group_dir}/analysis_ready/group_summary.csv", _group_summary_rows([project_id], data["event_sequence"], data["heartbeat_sessions"], data), GROUP_SUMMARY_FIELDNAMES)
        _write_csv(archive, f"{group_dir}/analysis_ready/student_summary.csv", _student_summary_rows(group_sequence, group_sessions, data), STUDENT_SUMMARY_FIELDNAMES)
        _write_csv(archive, f"{group_dir}/analysis_ready/group_stage_summary.csv", _group_stage_summary_rows([project_id], data["event_sequence"], data["heartbeat_sessions"], data), GROUP_STAGE_SUMMARY_FIELDNAMES)
        _write_csv(archive, f"{group_dir}/analysis_ready/intervention_exposure.csv", _intervention_exposure_rows([project_id], data["event_sequence"], data), INTERVENTION_EXPOSURE_FIELDNAMES)


def _group_rows(data: Dict[str, Any], user_code_map: Dict[str, str]) -> List[Dict[str, Any]]:
    return [
        {
            "project_id": str(project.id),
            "project_name": project.name,
            "course_id": project.course_id,
            **_condition_event_fields(data["project_condition_map"].get(str(project.id))),
            "leader_anonymous_id": _anonymize_user_id(project.leader_id, user_code_map),
            "member_count": len(project.members or []),
            "is_archived": project.is_archived,
            "created_at": project.created_at,
            "updated_at": project.updated_at,
        }
        for project in data["projects"]
    ]


def _group_member_rows(data: Dict[str, Any], user_code_map: Dict[str, str]) -> List[Dict[str, Any]]:
    return [
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
    ]


def _behavior_stream_rows(items: List[Dict[str, Any]], user_code_map: Dict[str, str]) -> List[Dict[str, Any]]:
    return [
        {
            "timestamp": item.get("timestamp"),
            "project_id": (item.get("metadata") or {}).get("project_id"),
            "anonymous_id": _anonymize_user_id((item.get("metadata") or {}).get("user_id"), user_code_map),
            "module": (item.get("metadata") or {}).get("module"),
            "action": (item.get("metadata") or {}).get("action"),
        }
        for item in items
    ]


def _heartbeat_stream_rows(items: List[Dict[str, Any]], user_code_map: Dict[str, str]) -> List[Dict[str, Any]]:
    return [
        {
            "timestamp": item.get("timestamp"),
            "project_id": (item.get("metadata") or {}).get("project_id"),
            "anonymous_id": _anonymize_user_id((item.get("metadata") or {}).get("user_id"), user_code_map),
            "module": (item.get("metadata") or {}).get("module"),
            "resource_id": (item.get("metadata") or {}).get("resource_id"),
        }
        for item in items
    ]


def _chat_log_rows(items: List[ChatLog], user_code_map: Dict[str, str]) -> List[Dict[str, Any]]:
    return [
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
        for item in items
    ]


def _research_event_rows(items: List[ResearchEvent], user_code_map: Dict[str, str]) -> List[Dict[str, Any]]:
    return [
        {
            "id": str(item.id),
            "project_id": item.project_id,
            "group_id": item.group_id,
            "anonymous_id": _anonymize_user_id(item.user_id, user_code_map),
            "actor_type": item.actor_type,
            "event_domain": item.event_domain,
            "event_type": item.event_type,
            "stage_id": _normalize_export_stage_id(item.stage_id),
            "sequence_index": item.sequence_index,
            "payload": item.payload,
            "event_time": item.event_time,
            "created_at": item.created_at,
        }
        for item in items
    ]


def _learning_object_memory_rows(items: List[LearningObjectMemory], user_code_map: Dict[str, str]) -> List[Dict[str, Any]]:
    return [
        {
            "id": str(item.id),
            "project_id": item.project_id,
            "group_id": item.group_id,
            "stage_id": _normalize_export_stage_id(item.stage_id),
            "condition_type": item.condition_type,
            "experiment_version_id": item.experiment_version_id,
            "optimization_version_id": item.optimization_version_id,
            "object_type": item.object_type,
            "title": item.title,
            "content": item.content,
            "keywords": _join_list(item.keywords),
            "source_types": _join_list(item.source_types),
            "source_refs": item.source_refs,
            "created_by_type": item.created_by_type,
            "created_by_anonymous_id": _anonymize_user_id(item.created_by_user_id, user_code_map),
            "status": item.status,
            "verification_state": item.verification_state,
            "confidence_score": item.confidence_score,
            "recency_score": item.recency_score,
            "source_quality_score": item.source_quality_score,
            "collaboration_score": item.collaboration_score,
            "last_confirmed_at": item.last_confirmed_at,
            "last_used_at": item.last_used_at,
            "superseded_by": item.superseded_by,
            "version": item.version,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
        }
        for item in items
    ]


def _scaffold_round_memory_rows(items: List[ScaffoldRoundMemory]) -> List[Dict[str, Any]]:
    return [
        {
            "id": str(item.id),
            "project_id": item.project_id,
            "group_id": item.group_id,
            "stage_id": _normalize_export_stage_id(item.stage_id),
            "condition_type": item.condition_type,
            "experiment_version_id": item.experiment_version_id,
            "optimization_version_id": item.optimization_version_id,
            "trigger_type": item.trigger_type,
            "trigger_reason": item.trigger_reason,
            "input_message_id": item.input_message_id,
            "output_message_id": item.output_message_id,
            "read_memory_ids": _join_list(item.read_memory_ids),
            "routing_mode": item.routing_mode,
            "selected_roles": _join_list(item.selected_roles),
            "primary_role": item.primary_role,
            "retrieval_sources": item.retrieval_sources,
            "response_text": item.response_text,
            "response_length": item.response_length,
            "response_style": item.response_style,
            "student_visible": item.student_visible,
            "followup_window_start": item.followup_window_start,
            "followup_window_end": item.followup_window_end,
            "followup_events": item.followup_events,
            "student_response_type": item.student_response_type,
            "outcome_label": item.outcome_label,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
        }
        for item in items
    ]


def _activity_log_rows(items: List[ActivityLog], user_code_map: Dict[str, str]) -> List[Dict[str, Any]]:
    return [
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
        for item in items
    ]


def _resource_rows(items: List[Resource], user_code_map: Dict[str, str]) -> List[Dict[str, Any]]:
    return [
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
        for item in items
    ]


def _document_rows(items: List[Document], user_code_map: Dict[str, str]) -> List[Dict[str, Any]]:
    return [
        {
            "id": str(item.id),
            "project_id": item.project_id,
            "title": item.title,
            "content_text_length": len(item.content or ""),
            "scope": getattr(item, "scope", None) or "shared",
            "owner_id": _anonymize_user_id(getattr(item, "owner_id", None) or item.last_modified_by, user_code_map),
            "last_modified_by": _anonymize_user_id(item.last_modified_by, user_code_map),
            "is_archived": item.is_archived,
            "source_type": item.source_type,
            "course_task_release_id": item.course_task_release_id,
            "created_at": item.created_at,
            "updated_at": item.updated_at,
        }
        for item in items
    ]


def _wiki_item_rows(items: List[WikiItem], user_code_map: Dict[str, str]) -> List[Dict[str, Any]]:
    return [
        {
            "id": str(item.id),
            "project_id": item.project_id,
            "stage_id": _normalize_export_stage_id(item.stage_id),
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
        for item in items
    ]


def _task_rows(items: List[Task], user_code_map: Dict[str, str]) -> List[Dict[str, Any]]:
    return [
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
        for item in items
    ]


def _ai_conversation_rows(items: List[AIConversation], user_code_map: Dict[str, str]) -> List[Dict[str, Any]]:
    return [
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
        for item in items
    ]


def _ai_message_rows(items: List[AIMessage], conversation_project_map: Dict[str, str]) -> List[Dict[str, Any]]:
    return [
        {
            "id": str(item.id),
            "project_id": conversation_project_map.get(item.conversation_id, ""),
            "conversation_id": item.conversation_id,
            "role": item.role,
            "content": item.content,
            "content_length": len(item.content or ""),
            "citations": item.citations,
            "metadata": item.metadata,
            "created_at": item.created_at,
        }
        for item in items
    ]


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
            writer.writerow(["research_event", str(item.id), item.project_id, item.user_id or "", item.event_type, json.dumps(_json_safe(item.payload), ensure_ascii=False), utc_isoformat(item.event_time)])
        for item in activity_logs:
            writer.writerow(["activity_log", str(item.id), item.project_id, item.user_id, item.action, json.dumps(_json_safe(item.metadata or {}), ensure_ascii=False), utc_isoformat(item.timestamp)])
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
