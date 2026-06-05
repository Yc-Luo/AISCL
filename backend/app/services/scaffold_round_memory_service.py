"""Scaffold round memory recording and lightweight outcome tracking."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from app.repositories.project import Project
from app.repositories.scaffold_round_memory import ScaffoldRoundMemory
from app.services.learning_object_memory_service import (
    is_experimental_memory_enabled,
    resolve_condition_type,
    resolve_experiment_version_id,
    resolve_optimization_version_id,
)
from app.services.memory_policy_config import get_memory_policy_config


def _routing_mode(ai_meta: Optional[dict]) -> str:
    summary = " ".join((ai_meta or {}).get("routing_summary") or [])
    if "并行" in summary:
        return "parallel"
    if "接力" in summary or "pipeline" in summary:
        return "pipeline"
    if "辩论" in summary:
        return "debate"
    return "single"


def _selected_roles(ai_meta: Optional[dict]) -> list[str]:
    roles: list[str] = []
    primary = (ai_meta or {}).get("primary_agent")
    if primary:
        roles.append(str(primary))
    for item in (ai_meta or {}).get("processing_summary") or []:
        text = str(item)
        for role in ("问题推进者", "资料研究员", "观点挑战者", "反馈追问者"):
            if role in text and role not in roles:
                roles.append(role)
    return roles[:4]


def _response_type_from_event(event_type: str, event_domain: Optional[str] = None) -> str:
    if event_type in {"peer_message_send", "peer_image_send"}:
        return "continued_discussion"
    if event_domain == "shared_record" or event_type in {"shared_record_content_commit", "document_save"}:
        return "edited_document"
    if event_domain == "wiki" or event_type.startswith("wiki_item_"):
        return "created_wiki"
    if event_domain == "inquiry_structure" or event_type in {"node_add", "node_content_commit", "edge_add"}:
        return "updated_inquiry_node"
    if event_type in {"resource_upload", "file_upload", "peer_image_send"}:
        return "uploaded_resource"
    if event_type in {"teacher_help_request_create", "teacher_help_request"}:
        return "asked_teacher"
    if event_type in {"task_submit", "course_task_submit"}:
        return "submitted_task"
    return "acknowledged"


class ScaffoldRoundMemoryService:
    """Persist experimental AI scaffold rounds and their follow-up evidence."""

    @staticmethod
    async def record_ai_round(
        *,
        project: Optional[Project],
        project_id: str,
        group_id: str,
        stage_id: Optional[str],
        experiment_version: Optional[dict],
        input_message_id: Optional[str],
        output_message_id: Optional[str],
        response_text: str,
        ai_meta: Optional[dict],
        read_memory_ids: Optional[List[str]] = None,
        retrieval_sources: Optional[List[Dict[str, Any]]] = None,
        trigger_type: str = "manual_mention",
        trigger_reason: str = "",
        response_style: str = "student_scaffold",
    ) -> Optional[str]:
        """Record one student-visible experimental scaffold round."""
        if not project or not is_experimental_memory_enabled(experiment_version):
            return None
        now = datetime.utcnow()
        policy = await get_memory_policy_config(experiment_version)
        round_memory = ScaffoldRoundMemory(
            course_id=project.course_id,
            project_id=project_id,
            group_id=group_id,
            stage_id=stage_id,
            condition_type=resolve_condition_type(experiment_version),
            experiment_version_id=resolve_experiment_version_id(experiment_version),
            optimization_version_id=policy["collaboration_optimization_version"]
            or resolve_optimization_version_id(experiment_version),
            trigger_type=trigger_type,
            trigger_reason=trigger_reason,
            input_message_id=input_message_id,
            output_message_id=output_message_id,
            read_memory_ids=read_memory_ids or [],
            routing_mode=_routing_mode(ai_meta),
            selected_roles=_selected_roles(ai_meta),
            primary_role=(ai_meta or {}).get("primary_agent"),
            retrieval_sources=retrieval_sources or [],
            response_text=response_text,
            response_length=len(response_text or ""),
            response_style=response_style,
            followup_window_start=now,
            followup_window_end=now + timedelta(minutes=policy["scaffold_followup_window_minutes"]),
            created_at=now,
            updated_at=now,
        )
        await round_memory.insert()
        try:
            from app.services.research_event_service import research_event_service

            await research_event_service.record_batch_events(
                events=[
                    {
                        "project_id": project_id,
                        "experiment_version_id": resolve_experiment_version_id(experiment_version),
                        "room_id": group_id,
                        "group_id": group_id,
                        "user_id": None,
                        "actor_type": "ai_assistant",
                        "event_domain": "scaffold",
                        "event_type": "scaffold_round_memory_created",
                        "stage_id": stage_id,
                        "payload": {
                            "scaffold_round_memory_id": str(round_memory.id),
                            "primary_role": round_memory.primary_role,
                            "routing_mode": round_memory.routing_mode,
                            "read_memory_count": len(round_memory.read_memory_ids),
                            "response_length": round_memory.response_length,
                        },
                    }
                ],
                current_user_id=None,
            )
        except Exception:
            pass
        return str(round_memory.id)

    @staticmethod
    async def record_followup_event(
        *,
        project_id: str,
        group_id: str,
        stage_id: Optional[str],
        user_id: Optional[str],
        event_type: str,
        event_domain: Optional[str],
        source_id: Optional[str],
    ) -> int:
        """Attach a student follow-up event to recent pending scaffold rounds."""
        now = datetime.utcnow()
        query: Dict[str, Any] = {
            "project_id": project_id,
            "group_id": group_id,
            "condition_type": "experimental",
            "outcome_label": "pending",
            "followup_window_start": {"$lte": now},
            "followup_window_end": {"$gte": now},
        }
        if stage_id:
            query["$or"] = [{"stage_id": stage_id}, {"stage_id": None}]

        rounds = await ScaffoldRoundMemory.find(query).sort("-created_at").limit(3).to_list()
        response_type = _response_type_from_event(event_type, event_domain)
        updated = 0
        for round_memory in rounds:
            round_memory.followup_events.append(
                {
                    "event_type": event_type,
                    "event_domain": event_domain,
                    "source_id": source_id,
                    "user_id": user_id,
                    "event_time": now.isoformat(),
                }
            )
            round_memory.student_response_type = response_type
            round_memory.outcome_label = response_type
            round_memory.updated_at = now
            await round_memory.save()
            updated += 1
        return updated

    @staticmethod
    async def get_recent_rounds(
        *,
        project_id: str,
        group_id: str,
        stage_id: Optional[str],
        limit: int = 2,
    ) -> list[ScaffoldRoundMemory]:
        """Return recent scaffold rounds for the same group only."""
        query: Dict[str, Any] = {
            "project_id": project_id,
            "group_id": group_id,
            "condition_type": "experimental",
        }
        if stage_id:
            query["$or"] = [{"stage_id": stage_id}, {"stage_id": None}]
        return await ScaffoldRoundMemory.find(query).sort("-created_at").limit(limit).to_list()

    @staticmethod
    def format_for_prompt(rounds: list[ScaffoldRoundMemory]) -> str:
        """Format recent scaffold outcomes for model context."""
        if not rounds:
            return ""
        lines = ["最近支架回合记忆（仅限本小组）："]
        for round_memory in rounds:
            outcome = round_memory.outcome_label or "pending"
            role = round_memory.primary_role or "AISCL智能助手"
            preview = " ".join((round_memory.response_text or "").split())[:160]
            lines.append(f"- [{role}/{outcome}] {preview}")
        return "\n".join(lines)


scaffold_round_memory_service = ScaffoldRoundMemoryService()
