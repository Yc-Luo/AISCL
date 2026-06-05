"""Prompt-ready memory retrieval with strict group-condition isolation."""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.repositories.project import Project
from app.services.collaboration_optimization_service import collaboration_optimization_service
from app.services.group_memory_service import group_memory_service
from app.services.learning_object_memory_service import (
    is_experimental_memory_enabled,
    learning_object_memory_service,
)
from app.services.memory_policy_config import get_memory_policy_config
from app.services.scaffold_round_memory_service import scaffold_round_memory_service


class MemoryRetrievalService:
    """Build memory context for experimental multi-agent replies only."""

    @staticmethod
    async def build_experimental_memory_context(
        *,
        project: Optional[Project],
        project_id: str,
        group_id: str,
        stage_id: Optional[str],
        user_message: str,
        experiment_version: Optional[dict],
    ) -> Dict[str, Any]:
        """Return memory context or empty values when the condition is not experimental."""
        if not project or not is_experimental_memory_enabled(experiment_version):
            return {
                "stage_memory": {},
                "group_state": {},
                "learning_objects": [],
                "learning_object_context": "",
                "scaffold_rounds": [],
                "scaffold_round_context": "",
                "collaboration_optimization": {},
                "collaboration_optimization_context": "",
                "read_memory_ids": [],
            }

        policy = await get_memory_policy_config(experiment_version)
        await learning_object_memory_service.mark_stale_objects(
            project_id=project_id,
            group_id=group_id,
            stage_id=stage_id,
            stale_after_days=policy["memory_stale_after_days"],
        )
        stage_memory = await group_memory_service.get_stage_memory_context(
            project_id=project_id,
            group_id=group_id,
            stage_id=stage_id,
        )
        group_state = await group_memory_service.refresh_and_get_group_state_context(
            project_id=project_id,
            group_id=group_id,
            stage_id=stage_id,
            project=project,
        )
        learning_objects = await learning_object_memory_service.get_relevant_objects(
            project_id=project_id,
            group_id=group_id,
            stage_id=stage_id,
            query_text=user_message,
            limit=policy["memory_prompt_object_limit"],
        )
        scaffold_rounds = await scaffold_round_memory_service.get_recent_rounds(
            project_id=project_id,
            group_id=group_id,
            stage_id=stage_id,
            limit=2,
        )
        collaboration_optimization = await collaboration_optimization_service.build_prompt_context(
            project_id=project_id,
            group_id=group_id,
            stage_id=stage_id,
            experiment_version=experiment_version,
        )

        read_memory_ids: list[str] = []
        for item in (stage_memory, group_state):
            if item.get("memory_id"):
                read_memory_ids.append(str(item["memory_id"]))
        read_memory_ids.extend(str(item.id) for item in learning_objects)
        read_memory_ids.extend(str(item.id) for item in scaffold_rounds)

        return {
            "stage_memory": stage_memory,
            "group_state": group_state,
            "learning_objects": learning_objects,
            "learning_object_context": learning_object_memory_service.format_for_prompt(learning_objects),
            "scaffold_rounds": scaffold_rounds,
            "scaffold_round_context": scaffold_round_memory_service.format_for_prompt(scaffold_rounds),
            "collaboration_optimization": collaboration_optimization,
            "collaboration_optimization_context": collaboration_optimization.get("content", ""),
            "read_memory_ids": read_memory_ids,
        }


memory_retrieval_service = MemoryRetrievalService()
