"""Deterministic collaboration optimization hints for experimental groups."""

from __future__ import annotations

from collections import Counter
from typing import Dict, Optional

from app.repositories.learning_object_memory import LearningObjectMemory
from app.repositories.scaffold_round_memory import ScaffoldRoundMemory
from app.services.learning_object_memory_service import (
    is_experimental_memory_enabled,
)
from app.services.memory_policy_config import get_memory_policy_config


class CollaborationOptimizationService:
    """Build safe, group-scoped optimization hints from memory outcomes."""

    @staticmethod
    async def build_prompt_context(
        *,
        project_id: str,
        group_id: str,
        stage_id: Optional[str],
        experiment_version: Optional[dict],
    ) -> Dict[str, str]:
        """Return prompt-ready optimization hints for experimental groups only."""
        if not is_experimental_memory_enabled(experiment_version):
            return {"content": "", "mode": "off", "optimization_version_id": None}
        policy = await get_memory_policy_config(experiment_version)
        mode = policy["collaboration_optimization_mode"]
        if mode == "off":
            return {
                "content": "",
                "mode": "off",
                "optimization_version_id": policy["collaboration_optimization_version"],
            }

        object_query = {
            "project_id": project_id,
            "group_id": group_id,
            "condition_type": "experimental",
            "status": {"$nin": ["rejected", "stale", "superseded"]},
        }
        round_query = {
            "project_id": project_id,
            "group_id": group_id,
            "condition_type": "experimental",
        }
        if stage_id:
            object_query["$or"] = [{"stage_id": stage_id}, {"stage_id": None}]
            round_query["$or"] = [{"stage_id": stage_id}, {"stage_id": None}]

        objects = await LearningObjectMemory.find(object_query).sort("-updated_at").limit(40).to_list()
        rounds = await ScaffoldRoundMemory.find(round_query).sort("-created_at").limit(12).to_list()

        type_counts = Counter(item.object_type for item in objects)
        status_counts = Counter(item.status for item in objects)
        outcome_counts = Counter(item.outcome_label for item in rounds)

        hints: list[str] = []
        if type_counts.get("claim", 0) >= 2 and type_counts.get("evidence", 0) == 0:
            hints.append("本组近期观点多于证据，优先引导成员补充来源、证据标准或资料摘录。")
        if type_counts.get("conflict", 0) or status_counts.get("contested", 0):
            hints.append("本组存在待处理分歧，优先帮助小组比较依据、边界和反例，不要直接裁决。")
        if type_counts.get("emotion_motivation", 0):
            hints.append("本组出现情绪或动机信号，回复应更短、更温和，并给出 10 分钟内能完成的小动作。")
        if outcome_counts.get("ignored", 0) or outcome_counts.get("pending", 0) >= 3:
            hints.append("近期支架回应不足，降低追问密度，改用一个清晰下一步和一个同伴接话邀请。")
        if outcome_counts.get("edited_document", 0) or outcome_counts.get("created_wiki", 0) or outcome_counts.get("updated_inquiry_node", 0):
            hints.append("近期支架后已有产物更新，可基于已有文档、Wiki 或论证节点继续推进修订。")
        if not hints and objects:
            hints.append("优先引用本组已形成的学习对象，但对待核验内容只提示比较和确认。")

        content = ""
        if hints:
            content = "协作学习优化提示（仅限本实验组）：\n" + "\n".join(f"- {hint}" for hint in hints[:4])
        if mode in {"shadow", "review"}:
            content = ""
        return {
            "content": content,
            "mode": mode if hints else "shadow",
            "optimization_version_id": policy["collaboration_optimization_version"],
        }


collaboration_optimization_service = CollaborationOptimizationService()
