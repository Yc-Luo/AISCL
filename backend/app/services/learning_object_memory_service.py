"""Learning-object memory extraction and retrieval."""

from __future__ import annotations

from datetime import datetime, timedelta
import re
from typing import Any, Dict, List, Optional

from app.repositories.learning_object_memory import LearningObjectMemory
from app.repositories.project import Project


OBJECT_PATTERNS: list[tuple[str, str]] = [
    ("evidence", r"证据|资料|来源|出处|文献|数据|案例|引用|调研|搜索|查到|根据"),
    ("counterargument", r"但是|不过|反驳|质疑|不同意|相反|另一种|替代|漏洞|局限|不一定|也可能"),
    ("decision", r"决定|确定|最终|采用|选择|统一|就按|共识"),
    ("todo", r"我来|你来|谁负责|分工|下一步|待办|先做|提交|补充"),
    ("emotion_motivation", r"不会|太难|没思路|没办法|失败|崩|烦|焦虑|来不及|不知道"),
    ("question", r"\?|？|问题|为什么|怎么|如何|能不能|是不是"),
    ("claim", r"我认为|我觉得|观点|结论|应该|因为|所以|说明|证明|意味着|可能是|可以看出"),
]

SOURCE_QUALITY = {
    "document": 0.75,
    "wiki": 0.75,
    "inquiry_node": 0.7,
    "resource": 0.65,
    "teacher_feedback": 0.85,
    "student_chat": 0.4,
    "ai_reply": 0.2,
}


def is_experimental_memory_enabled(experiment_version: Optional[dict]) -> bool:
    """Return true only for the multi-agent experimental memory condition."""
    mode = str((experiment_version or {}).get("ai_scaffold_mode") or "").strip().lower()
    return mode in {"multi_agent", "multi", "multiagent", "multi_ai"}


def resolve_condition_type(experiment_version: Optional[dict]) -> str:
    """Map experiment configuration to memory condition type."""
    if is_experimental_memory_enabled(experiment_version):
        return "experimental"
    if (experiment_version or {}).get("ai_scaffold_mode"):
        return "control"
    return "unknown"


def resolve_experiment_version_id(experiment_version: Optional[dict]) -> Optional[str]:
    """Resolve a stable experiment-version label for memory records."""
    if not experiment_version:
        return None
    return experiment_version.get("version_name") or experiment_version.get("name")


def resolve_optimization_version_id(experiment_version: Optional[dict]) -> Optional[str]:
    """Resolve the currently active optimization policy version, if any."""
    if not experiment_version:
        return None
    return (
        experiment_version.get("optimization_version_id")
        or experiment_version.get("optimizationVersionId")
        or experiment_version.get("collaboration_optimization_version")
    )


def _clean_text(text: str, max_chars: int = 500) -> str:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[:max_chars].rstrip() + "..."


def _title_from_content(content: str, max_chars: int = 48) -> str:
    cleaned = _clean_text(content, max_chars=max_chars + 12)
    return cleaned[:max_chars].rstrip() + ("..." if len(cleaned) > max_chars else "")


def _classify_learning_objects(content: str) -> list[str]:
    text = content or ""
    object_types: list[str] = []
    for object_type, pattern in OBJECT_PATTERNS:
        if re.search(pattern, text, flags=re.IGNORECASE) and object_type not in object_types:
            object_types.append(object_type)
    return object_types[:3]


def _keywords(content: str) -> list[str]:
    words = re.findall(r"[\u4e00-\u9fa5A-Za-z0-9]{2,}", content or "")
    stop_words = {"我们", "你们", "这个", "那个", "可以", "需要", "应该", "因为", "所以"}
    result: list[str] = []
    for word in words:
        if word in stop_words or word in result:
            continue
        result.append(word[:24])
        if len(result) >= 12:
            break
    return result


def _source_quality(source_types: list[str]) -> float:
    if not source_types:
        return 0.3
    return max(SOURCE_QUALITY.get(source_type, 0.3) for source_type in source_types)


class LearningObjectMemoryService:
    """Create, update, and retrieve group-scoped learning objects."""

    @staticmethod
    async def record_from_student_chat(
        *,
        project: Optional[Project],
        project_id: str,
        group_id: str,
        stage_id: Optional[str],
        user_id: str,
        chat_log_id: str,
        content: str,
        experiment_version: Optional[dict],
    ) -> list[str]:
        """Extract conservative student-sourced learning objects from one chat message."""
        if not project or not is_experimental_memory_enabled(experiment_version):
            return []
        cleaned = _clean_text(content)
        if len(cleaned) < 12:
            return []

        object_types = _classify_learning_objects(cleaned)
        if not object_types:
            return []

        created_ids: list[str] = []
        updated_types: list[str] = []
        for object_type in object_types:
            memory = await LearningObjectMemory.find_one(
                LearningObjectMemory.project_id == project_id,
                LearningObjectMemory.group_id == group_id,
                LearningObjectMemory.stage_id == stage_id,
                LearningObjectMemory.object_type == object_type,
                LearningObjectMemory.title == _title_from_content(cleaned),
                LearningObjectMemory.condition_type == "experimental",
            )
            source_ref = {
                "type": "student_chat",
                "id": chat_log_id,
                "user_id": user_id,
                "created_at": datetime.utcnow().isoformat(),
            }
            now = datetime.utcnow()
            if memory:
                if not any(ref.get("id") == chat_log_id for ref in memory.source_refs):
                    memory.source_refs.append(source_ref)
                memory.source_types = list(dict.fromkeys([*memory.source_types, "student_chat"]))
                memory.status = "active" if memory.status == "proposed" else memory.status
                memory.verification_state = "student_supported"
                memory.source_quality_score = max(memory.source_quality_score, _source_quality(memory.source_types))
                memory.collaboration_score = min(1.0, memory.collaboration_score + 0.15)
                memory.last_used_at = now
                memory.version += 1
                memory.updated_at = now
                await memory.save()
            else:
                memory = LearningObjectMemory(
                    course_id=project.course_id,
                    project_id=project_id,
                    group_id=group_id,
                    stage_id=stage_id,
                    condition_type="experimental",
                    experiment_version_id=resolve_experiment_version_id(experiment_version),
                    optimization_version_id=resolve_optimization_version_id(experiment_version),
                    object_type=object_type,
                    title=_title_from_content(cleaned),
                    content=cleaned,
                    keywords=_keywords(cleaned),
                    source_refs=[source_ref],
                    source_types=["student_chat"],
                    created_by_type="student",
                    created_by_user_id=user_id,
                    status="proposed",
                    verification_state="student_supported",
                    confidence_score=0.45,
                    source_quality_score=_source_quality(["student_chat"]),
                    collaboration_score=0.1,
                    last_used_at=now,
                    created_at=now,
                    updated_at=now,
                )
                await memory.insert()
            created_ids.append(str(memory.id))
            updated_types.append(object_type)
        if created_ids:
            try:
                from app.services.research_event_service import research_event_service

                await research_event_service.record_batch_events(
                    events=[
                        {
                            "project_id": project_id,
                            "experiment_version_id": resolve_experiment_version_id(experiment_version),
                            "room_id": group_id,
                            "group_id": group_id,
                            "user_id": user_id,
                            "actor_type": "student",
                            "event_domain": "scaffold",
                            "event_type": "learning_object_memory_updated",
                            "stage_id": stage_id,
                            "payload": {
                                "learning_object_ids": created_ids,
                                "object_types": updated_types,
                                "source_chat_log_id": chat_log_id,
                            },
                        }
                    ],
                    current_user_id=user_id,
                )
            except Exception:
                pass
        return created_ids

    @staticmethod
    async def get_relevant_objects(
        *,
        project_id: str,
        group_id: str,
        stage_id: Optional[str],
        query_text: str,
        limit: int = 8,
    ) -> list[LearningObjectMemory]:
        """Return active learning objects scoped to exactly one group."""
        query: Dict[str, Any] = {
            "project_id": project_id,
            "group_id": group_id,
            "condition_type": "experimental",
            "status": {"$nin": ["rejected", "stale", "superseded"]},
        }
        if stage_id:
            query["$or"] = [{"stage_id": stage_id}, {"stage_id": None}]

        items = await LearningObjectMemory.find(query).sort("-updated_at").limit(40).to_list()
        query_keywords = set(_keywords(query_text))

        def score(item: LearningObjectMemory) -> float:
            keyword_overlap = len(query_keywords.intersection(item.keywords or []))
            status_bonus = {
                "verified": 0.35,
                "adopted": 0.3,
                "active": 0.2,
                "contested": 0.18,
                "proposed": 0.05,
            }.get(item.status, 0)
            conflict_bonus = 0.1 if item.status == "contested" else 0
            return (
                keyword_overlap * 0.2
                + item.confidence_score * 0.25
                + item.source_quality_score * 0.25
                + item.collaboration_score * 0.15
                + status_bonus
                + conflict_bonus
            )

        return sorted(items, key=score, reverse=True)[:limit]

    @staticmethod
    async def mark_stale_objects(
        *,
        project_id: str,
        group_id: str,
        stage_id: Optional[str],
        stale_after_days: int = 14,
    ) -> int:
        """Mark old active/proposed objects as stale without deleting evidence."""
        cutoff = datetime.utcnow() - timedelta(days=stale_after_days)
        query: Dict[str, Any] = {
            "project_id": project_id,
            "group_id": group_id,
            "condition_type": "experimental",
            "status": {"$in": ["proposed", "active"]},
            "$or": [
                {"last_used_at": {"$lt": cutoff}},
                {"last_used_at": None, "updated_at": {"$lt": cutoff}},
            ],
        }
        if stage_id:
            query["stage_id"] = stage_id
        items = await LearningObjectMemory.find(query).limit(50).to_list()
        now = datetime.utcnow()
        for item in items:
            item.status = "stale"
            item.recency_score = 0
            item.version += 1
            item.updated_at = now
            await item.save()
        return len(items)

    @staticmethod
    def format_for_prompt(items: list[LearningObjectMemory]) -> str:
        """Format learning objects for model context without overloading the prompt."""
        if not items:
            return ""
        lines = ["共同学习对象记忆（仅限本小组，未核验内容只能提示核验）："]
        for item in items:
            status = {
                "proposed": "待确认",
                "active": "讨论中",
                "adopted": "已采纳",
                "verified": "已确认",
                "contested": "有争议",
            }.get(item.status, item.status)
            lines.append(f"- [{item.object_type}/{status}] {item.title}：{_clean_text(item.content, 180)}")
        return "\n".join(lines)


learning_object_memory_service = LearningObjectMemoryService()
