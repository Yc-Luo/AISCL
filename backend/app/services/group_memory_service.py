"""Service for internal group rolling memory summaries."""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from app.core.llm_config import get_llm
from app.repositories.chat_log import ChatLog
from app.repositories.course_task_release import CourseTaskRelease
from app.repositories.document import Document
from app.repositories.group_memory_summary import GroupMemorySummary
from app.repositories.project import Project
from app.repositories.research_event import ResearchEvent
from app.repositories.user import User
from app.repositories.wiki_item import WikiItem
from app.services.ai_service import AIService


CONTENT_DEFAULT: Dict[str, Any] = {
    "core_question": "",
    "formed_views": [],
    "evidence_sources": [],
    "controversies": [],
    "ai_scaffold_summary": [],
    "unresolved_questions": [],
    "next_steps": [],
}

CONTENT_LABELS = {
    "core_question": "本阶段核心问题",
    "formed_views": "已形成观点/阶段性共识",
    "evidence_sources": "证据与资料线索",
    "controversies": "分歧、争议与待澄清点",
    "ai_scaffold_summary": "AI支架介入摘要",
    "unresolved_questions": "尚未解决的问题",
    "next_steps": "下一步推进建议",
}

ARTIFACT_DOMAINS = {"shared_record", "inquiry_structure", "wiki"}
SCAFFOLD_DOMAINS = {"scaffold", "stage_transition"}
SUMMARY_CHAT_LIMIT = 80
SUMMARY_EVENT_LIMIT = 80
EVENT_THRESHOLD = 8
AI_INTERACTION_THRESHOLD = 2
ARTIFACT_THRESHOLD = 3


def _truncate_text(text: str, max_chars: int = 420) -> str:
    normalized = re.sub(r"\s+", " ", text or "").strip()
    if len(normalized) <= max_chars:
        return normalized
    return normalized[:max_chars].rstrip() + "..."


def _is_ai_interaction(message: ChatLog) -> bool:
    content = message.content or ""
    return (
        message.user_id == "ai_assistant"
        or bool(message.user_id and message.user_id.startswith("auto_prompt:"))
        or "@AI" in content
        or "@AISCL" in content
        or "@资料研究员" in content
        or "@观点挑战者" in content
        or "@反馈追问者" in content
        or "@问题推进者" in content
    )


def _normalize_content(raw_content: Dict[str, Any]) -> Dict[str, Any]:
    content = {**CONTENT_DEFAULT}
    if not isinstance(raw_content, dict):
        return content

    for key, default_value in CONTENT_DEFAULT.items():
        value = raw_content.get(key, default_value)
        if isinstance(default_value, list):
            if isinstance(value, list):
                content[key] = [str(item).strip() for item in value if str(item).strip()]
            elif isinstance(value, str) and value.strip():
                content[key] = [value.strip()]
            else:
                content[key] = []
        else:
            content[key] = str(value or "").strip()
    return content


def _format_content_for_prompt(content: Dict[str, Any]) -> str:
    normalized = _normalize_content(content)
    lines: List[str] = []
    for key, label in CONTENT_LABELS.items():
        value = normalized.get(key)
        lines.append(f"{label}：")
        if isinstance(value, list):
            lines.extend(f"- {item}" for item in value if item)
            if not value:
                lines.append("- 暂无")
        else:
            lines.append(value or "暂无")
    return "\n".join(lines)


def _extract_json_object(text: str) -> Dict[str, Any]:
    cleaned = AIService.sanitize_model_output(text or "")
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned.strip())
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        cleaned = cleaned[start : end + 1]
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return _normalize_content(parsed)
    except Exception:
        pass
    fallback = _normalize_content({})
    fallback["unresolved_questions"] = [_truncate_text(cleaned, 800)] if cleaned else []
    return fallback


def _merge_counts(previous: Dict[str, int], current: Dict[str, int]) -> Dict[str, int]:
    keys = {
        "dialogue",
        "ai_interaction",
        "artifact",
        "scaffold",
        "stage_transition",
        "total",
    }
    return {key: int(previous.get(key, 0)) + int(current.get(key, 0)) for key in keys}


def _latest_datetime(values: List[Optional[datetime]]) -> Optional[datetime]:
    present = [value for value in values if value]
    return max(present) if present else None


def _earliest_datetime(values: List[Optional[datetime]]) -> Optional[datetime]:
    present = [value for value in values if value]
    return min(present) if present else None


class GroupMemoryService:
    """CRUD and event-driven refresh rules for group memory summaries."""

    @staticmethod
    async def get_project_task_context(project: Optional[Project] = None, project_id: Optional[str] = None) -> str:
        """Build the shared task brief used by all student-facing AI entry points."""
        if not project and project_id:
            project = await Project.get(project_id)
        if not project:
            return ""

        sections = [
            f"项目名称：{project.name}",
        ]
        if project.description:
            sections.append(f"项目目标：{project.description}")

        project_id_str = str(project.id)
        seen_document_ids: set[str] = set()

        def format_task_section(
            *,
            source_label: str,
            title: str,
            content: str,
            due_at: Optional[datetime] = None,
            status: Optional[str] = None,
        ) -> Optional[str]:
            normalized_content = _truncate_text(content, 1800)
            if not normalized_content and not title:
                return None
            lines = [f"任务来源：{source_label}"]
            if status:
                lines.append(f"任务状态：{status}")
            if due_at:
                lines.append(f"截止时间：{due_at.strftime('%Y-%m-%d %H:%M')}")
            if title:
                lines.append(f"任务说明标题：{title}")
            if normalized_content:
                lines.append(f"任务说明内容：\n{normalized_content}")
            return "\n".join(lines)

        async def get_release_document(release_id: str) -> Optional[Document]:
            return await Document.find_one(
                {
                    "project_id": project_id_str,
                    "source_type": "course_task_release",
                    "course_task_release_id": release_id,
                    "is_archived": False,
                }
            )

        release_sections: List[str] = []
        releases = (
            await CourseTaskRelease.find(
                {
                    "target_project_ids": project_id_str,
                    "status": "open",
                }
            )
            .sort("-published_at")
            .limit(3)
            .to_list()
        )
        source_label = "教师发布任务（进行中）"
        if not releases:
            releases = (
                await CourseTaskRelease.find({"target_project_ids": project_id_str})
                .sort("-published_at")
                .limit(2)
                .to_list()
            )
            source_label = "最近教师发布任务"

        for release in releases:
            document = await get_release_document(str(release.id))
            if document:
                seen_document_ids.add(str(document.id))
            document_content = (document.content if document else None) or (document.preview_text if document else None)
            fallback_content = "\n\n".join(
                f"{label}\n{value.strip()}"
                for label, value in [
                    ("任务背景", release.task_background),
                    ("核心问题", release.core_question),
                    ("协作要求", release.collaboration_requirements),
                    ("提交成果", release.deliverable_requirements),
                    ("评价要点", release.evaluation_points),
                ]
                if value and value.strip()
            )
            section = format_task_section(
                source_label=source_label,
                title=(document.title if document else None) or release.title,
                content=document_content or fallback_content,
                due_at=release.due_at,
                status="开放" if release.status == "open" else "已关闭",
            )
            if section:
                release_sections.append(section)

        sections.extend(release_sections)

        initial_task_title = ""
        initial_task_content = ""
        if project.initial_task_document_id:
            try:
                task_document = await Document.get(project.initial_task_document_id)
            except Exception:
                task_document = None
            if task_document and str(task_document.id) not in seen_document_ids:
                initial_task_title = task_document.title or ""
                initial_task_content = task_document.content or task_document.preview_text or ""

        initial_section = format_task_section(
            source_label="项目初始说明",
            title=initial_task_title,
            content=initial_task_content,
        )
        if initial_section:
            sections.append(initial_section)

        if not release_sections and not initial_task_content:
            task_items = (
                await WikiItem.find(
                    WikiItem.project_id == project_id_str,
                    WikiItem.item_type == "task_brief",
                )
                .sort("-updated_at")
                .limit(2)
                .to_list()
            )
            for task_item in task_items:
                section = format_task_section(
                    source_label="项目Wiki任务说明",
                    title=task_item.title,
                    content=task_item.content or task_item.summary or "",
                )
                if section:
                    sections.append(section)

        return "\n".join(section for section in sections if section.strip())

    @staticmethod
    async def get_stage_memory(
        *,
        project_id: str,
        group_id: Optional[str],
        stage_id: Optional[str],
    ) -> Optional[GroupMemorySummary]:
        """Read active memory for one group-stage pair."""
        if not stage_id:
            return None
        return await GroupMemorySummary.find_one(
            GroupMemorySummary.project_id == project_id,
            GroupMemorySummary.group_id == group_id,
            GroupMemorySummary.stage_id == stage_id,
            GroupMemorySummary.memory_type == "stage_rolling_summary",
            GroupMemorySummary.deleted_at == None,  # noqa: E711
        )

    @staticmethod
    def format_memory_for_prompt(memory: Optional[GroupMemorySummary]) -> str:
        """Format internal memory for model context."""
        if not memory:
            return ""
        return _format_content_for_prompt(memory.content)

    @classmethod
    async def get_stage_memory_context(
        cls,
        *,
        project_id: str,
        group_id: Optional[str],
        stage_id: Optional[str],
    ) -> Dict[str, Any]:
        """Read and format memory context for AI prompts."""
        memory = await cls.get_stage_memory(project_id=project_id, group_id=group_id, stage_id=stage_id)
        if not memory:
            return {"content": "", "memory_id": None}
        return {
            "content": cls.format_memory_for_prompt(memory),
            "memory_id": str(memory.id),
            "version": memory.version,
            "updated_at": memory.updated_at.isoformat() if memory.updated_at else None,
        }

    @staticmethod
    async def soft_delete_memory(memory: GroupMemorySummary, *, actor_id: str = "system") -> None:
        """Soft delete memory so raw learning traces remain intact."""
        memory.deleted_at = datetime.utcnow()
        memory.updated_by = actor_id
        memory.updated_at = datetime.utcnow()
        await memory.save()

    @classmethod
    async def maybe_refresh_stage_memory(
        cls,
        *,
        project_id: str,
        group_id: Optional[str],
        stage_id: Optional[str],
        trigger: str = "on_ai_request",
        force: bool = False,
    ) -> Dict[str, Any]:
        """Update memory only when new effective learning events exist."""
        if not stage_id:
            return {"updated": False, "reason": "missing_stage"}

        existing = await cls.get_stage_memory(project_id=project_id, group_id=group_id, stage_id=stage_id)
        snapshot = await cls._collect_new_sources(
            project_id=project_id,
            group_id=group_id,
            stage_id=stage_id,
            existing=existing,
        )
        counts = snapshot["counts"]
        update_trigger = cls._resolve_update_trigger(existing, counts, trigger, force)
        if not update_trigger:
            return {"updated": False, "reason": "threshold_not_met", "counts": counts}

        content = await cls._summarize_sources(
            existing_content=existing.content if existing else CONTENT_DEFAULT,
            stage_id=stage_id,
            chat_lines=snapshot["chat_lines"],
            event_lines=snapshot["event_lines"],
        )
        memory = await cls._upsert_memory(
            existing=existing,
            project_id=project_id,
            group_id=group_id,
            stage_id=stage_id,
            content=content,
            snapshot=snapshot,
            counts=counts,
            update_trigger=update_trigger,
        )
        await cls._record_memory_event(memory, update_trigger, counts)
        return {
            "updated": True,
            "memory_id": str(memory.id),
            "version": memory.version,
            "trigger": update_trigger,
            "counts": counts,
        }

    @staticmethod
    def _resolve_update_trigger(
        existing: Optional[GroupMemorySummary],
        counts: Dict[str, int],
        requested_trigger: str,
        force: bool,
    ) -> str:
        if force or requested_trigger == "manual_regenerate":
            return "manual_regenerate"
        if counts.get("total", 0) <= 0:
            return ""
        if counts.get("stage_transition", 0) > 0 or requested_trigger == "stage_transition":
            return "stage_transition"
        if not existing:
            return "initial"
        if counts.get("artifact", 0) >= ARTIFACT_THRESHOLD:
            return "artifact_threshold"
        if counts.get("ai_interaction", 0) >= AI_INTERACTION_THRESHOLD:
            return "ai_interaction_threshold"
        if counts.get("total", 0) >= EVENT_THRESHOLD:
            return "event_threshold"
        return ""

    @classmethod
    async def _collect_new_sources(
        cls,
        *,
        project_id: str,
        group_id: Optional[str],
        stage_id: str,
        existing: Optional[GroupMemorySummary],
    ) -> Dict[str, Any]:
        chat_logs = await cls._collect_chat_logs(project_id, stage_id, existing)
        research_events = await cls._collect_research_events(project_id, group_id, stage_id, existing)
        chat_lines = await cls._format_chat_lines(chat_logs)
        event_lines = cls._format_event_lines(research_events)

        artifact_count = sum(1 for event in research_events if event.event_domain in ARTIFACT_DOMAINS)
        scaffold_count = sum(1 for event in research_events if event.event_domain in SCAFFOLD_DOMAINS)
        stage_transition_count = sum(1 for event in research_events if event.event_domain == "stage_transition")
        ai_interaction_count = sum(1 for message in chat_logs if _is_ai_interaction(message))
        counts = {
            "dialogue": len(chat_logs),
            "ai_interaction": ai_interaction_count,
            "artifact": artifact_count,
            "scaffold": scaffold_count,
            "stage_transition": stage_transition_count,
            "total": len(chat_logs) + artifact_count + scaffold_count,
        }

        times = [message.created_at for message in chat_logs] + [event.event_time for event in research_events]
        return {
            "chat_logs": chat_logs,
            "research_events": research_events,
            "chat_lines": chat_lines,
            "event_lines": event_lines,
            "counts": counts,
            "source_range": {
                "from_time": _earliest_datetime(times),
                "to_time": _latest_datetime(times),
            },
        }

    @staticmethod
    async def _collect_chat_logs(
        project_id: str,
        stage_id: str,
        existing: Optional[GroupMemorySummary],
    ) -> List[ChatLog]:
        query: Dict[str, Any] = {
            "project_id": project_id,
            "metadata.stage_id": stage_id,
            "metadata.teacher_help_request": {"$ne": True},
            "metadata.teacher_private_reply": {"$ne": True},
        }
        if existing and existing.last_processed_chat_time:
            query["created_at"] = {"$gt": existing.last_processed_chat_time}

        messages = (
            await ChatLog.find(query)
            .sort("created_at")
            .limit(SUMMARY_CHAT_LIMIT)
            .to_list()
        )

        if not messages and not existing:
            fallback_query = {
                "project_id": project_id,
                "metadata.teacher_help_request": {"$ne": True},
                "metadata.teacher_private_reply": {"$ne": True},
            }
            messages = (
                await ChatLog.find(fallback_query)
                .sort("-created_at")
                .limit(min(SUMMARY_CHAT_LIMIT, 30))
                .to_list()
            )
            messages = list(reversed(messages))
        return messages

    @staticmethod
    async def _collect_research_events(
        project_id: str,
        group_id: Optional[str],
        stage_id: str,
        existing: Optional[GroupMemorySummary],
    ) -> List[ResearchEvent]:
        query: Dict[str, Any] = {
            "project_id": project_id,
            "stage_id": stage_id,
            "event_type": {"$ne": "group_memory_summary_updated"},
        }
        if group_id:
            query["$or"] = [{"group_id": group_id}, {"room_id": group_id}]
        if existing and existing.last_processed_event_time:
            query["event_time"] = {"$gt": existing.last_processed_event_time}

        return (
            await ResearchEvent.find(query)
            .sort("event_time")
            .limit(SUMMARY_EVENT_LIMIT)
            .to_list()
        )

    @staticmethod
    async def _format_chat_lines(chat_logs: List[ChatLog]) -> List[str]:
        user_ids = [
            message.user_id
            for message in chat_logs
            if message.user_id
            and message.user_id not in {"system", "ai_assistant"}
            and not message.user_id.startswith("auto_prompt:")
        ]
        users = {}
        if user_ids:
            import bson

            object_ids = [bson.ObjectId(uid) for uid in set(user_ids) if bson.ObjectId.is_valid(uid)]
            if object_ids:
                user_list = await User.find({"_id": {"$in": object_ids}}).to_list()
                users = {str(user.id): user for user in user_list}

        lines = []
        for message in chat_logs:
            metadata = message.metadata or {}
            user = users.get(message.user_id)
            if user:
                username = user.username or user.email
            elif message.user_id == "ai_assistant":
                ai_meta = metadata.get("ai_meta") if isinstance(metadata, dict) else None
                username = (
                    ai_meta.get("primary_agent")
                    if isinstance(ai_meta, dict) and ai_meta.get("primary_agent")
                    else "AISCL智能助手"
                )
            elif message.user_id and message.user_id.startswith("auto_prompt:"):
                username = "系统支架提示"
            else:
                username = "系统"
            time_label = message.created_at.strftime("%m-%d %H:%M") if message.created_at else ""
            content = _truncate_text(message.content or "")
            if content:
                lines.append(f"- [{time_label}] {username}: {content}")
        return lines

    @staticmethod
    def _format_event_lines(events: List[ResearchEvent]) -> List[str]:
        lines = []
        for event in events:
            payload = event.payload or {}
            payload_preview = _truncate_text(json.dumps(payload, ensure_ascii=False, default=str), 360)
            time_label = event.event_time.strftime("%m-%d %H:%M") if event.event_time else ""
            lines.append(
                f"- [{time_label}] {event.event_domain}/{event.event_type}: {payload_preview}"
            )
        return lines

    @staticmethod
    async def _summarize_sources(
        *,
        existing_content: Dict[str, Any],
        stage_id: str,
        chat_lines: List[str],
        event_lines: List[str],
    ) -> Dict[str, Any]:
        llm = await get_llm(temperature=0.2)
        response = await llm.ainvoke(
            [
                SystemMessage(
                    content=(
                        "你是 AISCL 的小组协作记忆维护器。你只维护内部记忆，不向学生展示。"
                        "请基于已有记忆和新增学习事件更新摘要，不要虚构，不要评价学生个人，"
                        "不要输出思维过程。"
                    )
                ),
                HumanMessage(
                    content=f"""当前阶段：{stage_id}

已有记忆：
{_format_content_for_prompt(existing_content)}

新增小组对话：
{chr(10).join(chat_lines) if chat_lines else "无"}

新增学习事件：
{chr(10).join(event_lines) if event_lines else "无"}

请输出严格 JSON，不要 Markdown，不要解释。字段如下：
{{
  "core_question": "本阶段核心问题，字符串",
  "formed_views": ["已形成观点或阶段性共识"],
  "evidence_sources": ["证据与资料线索"],
  "controversies": ["分歧、争议与待澄清点"],
  "ai_scaffold_summary": ["AI支架介入摘要"],
  "unresolved_questions": ["尚未解决的问题"],
  "next_steps": ["下一步推进建议"]
}}"""
                ),
            ]
        )
        text = response.content if hasattr(response, "content") else str(response)
        return _extract_json_object(text)

    @staticmethod
    async def _upsert_memory(
        *,
        existing: Optional[GroupMemorySummary],
        project_id: str,
        group_id: Optional[str],
        stage_id: str,
        content: Dict[str, Any],
        snapshot: Dict[str, Any],
        counts: Dict[str, int],
        update_trigger: str,
    ) -> GroupMemorySummary:
        chat_logs: List[ChatLog] = snapshot["chat_logs"]
        research_events: List[ResearchEvent] = snapshot["research_events"]
        source_chat_ids = [str(message.id) for message in chat_logs]
        source_event_ids = [str(event.id) for event in research_events]
        latest_chat = chat_logs[-1] if chat_logs else None
        latest_event = research_events[-1] if research_events else None
        now = datetime.utcnow()

        if existing:
            existing.content = content
            existing.source_chat_log_ids = list(dict.fromkeys(existing.source_chat_log_ids + source_chat_ids))[-200:]
            existing.source_research_event_ids = list(dict.fromkeys(existing.source_research_event_ids + source_event_ids))[-200:]
            existing.source_counts = _merge_counts(existing.source_counts or {}, counts)
            existing.source_range = {
                "from_time": existing.source_range.get("from_time") or snapshot["source_range"].get("from_time"),
                "to_time": snapshot["source_range"].get("to_time") or existing.source_range.get("to_time"),
            }
            existing.last_processed_chat_log_id = str(latest_chat.id) if latest_chat else existing.last_processed_chat_log_id
            existing.last_processed_research_event_id = str(latest_event.id) if latest_event else existing.last_processed_research_event_id
            existing.last_processed_chat_time = latest_chat.created_at if latest_chat else existing.last_processed_chat_time
            existing.last_processed_event_time = latest_event.event_time if latest_event else existing.last_processed_event_time
            existing.version += 1
            existing.update_trigger = update_trigger
            existing.updated_by = "system"
            existing.updated_at = now
            await existing.save()
            return existing

        memory = GroupMemorySummary(
            project_id=project_id,
            group_id=group_id,
            stage_id=stage_id,
            content=content,
            source_chat_log_ids=source_chat_ids[-200:],
            source_research_event_ids=source_event_ids[-200:],
            source_counts=counts,
            source_range=snapshot["source_range"],
            last_processed_chat_log_id=str(latest_chat.id) if latest_chat else None,
            last_processed_research_event_id=str(latest_event.id) if latest_event else None,
            last_processed_chat_time=latest_chat.created_at if latest_chat else None,
            last_processed_event_time=latest_event.event_time if latest_event else None,
            version=1,
            update_trigger=update_trigger,
            visible_to_student=False,
            created_by="system",
            updated_by="system",
            created_at=now,
            updated_at=now,
        )
        await memory.insert()
        return memory

    @staticmethod
    async def _record_memory_event(
        memory: GroupMemorySummary,
        update_trigger: str,
        counts: Dict[str, int],
    ) -> None:
        try:
            from app.services.research_event_service import research_event_service

            await research_event_service.record_batch_events(
                events=[
                    {
                        "project_id": memory.project_id,
                        "room_id": memory.group_id,
                        "group_id": memory.group_id,
                        "user_id": None,
                        "actor_type": "system",
                        "event_domain": "scaffold",
                        "event_type": "group_memory_summary_updated",
                        "stage_id": memory.stage_id,
                        "payload": {
                            "memory_id": str(memory.id),
                            "memory_type": memory.memory_type,
                            "version": memory.version,
                            "update_trigger": update_trigger,
                            "source_counts": counts,
                            "visible_to_student": memory.visible_to_student,
                        },
                    }
                ],
                current_user_id=None,
            )
        except Exception:
            return


group_memory_service = GroupMemoryService()
