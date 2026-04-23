"""Research configuration service for binding admin-published templates to courses and projects."""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime
from typing import Any, Dict, Optional

from app.repositories.course import Course
from app.repositories.system_config import SystemConfig


class ResearchConfigService:
    """Resolve experiment template bindings from admin configuration snapshots."""

    TEMPLATE_CONFIG_KEY = "research_experiment_templates"
    ORCHESTRATION_CONFIG_KEY = "research_orchestration_profile"
    RELEASE_HISTORY_KEY = "research_release_history"

    ALL_SCAFFOLD_ROLES = [
        "cognitive_support",
        "viewpoint_challenge",
        "feedback_prompting",
        "problem_progression",
    ]

    LEGACY_PRESETS: Dict[str, Dict[str, Any]] = {
        "exp-single-process-v1": {
            "label": "单AI + 过程支架",
            "groupCondition": "single_agent_process_on",
            "aiMode": "single_agent",
            "processMode": "on",
            "ruleSet": "research-default",
            "stageSequence": ["orientation", "planning", "inquiry", "argumentation", "revision"],
        },
        "exp-multi-process-v1": {
            "label": "多智能体 + 过程支架",
            "groupCondition": "multi_agent_process_on",
            "aiMode": "multi_agent",
            "processMode": "on",
            "ruleSet": "research-default",
            "stageSequence": ["orientation", "planning", "inquiry", "argumentation", "revision"],
        },
        "exp-single-process-off-v1": {
            "label": "单AI + 无过程支架",
            "groupCondition": "single_agent_process_off",
            "aiMode": "single_agent",
            "processMode": "off",
            "ruleSet": "evidence-focus",
            "stageSequence": ["orientation", "planning", "inquiry", "argumentation", "revision"],
        },
    }

    @classmethod
    async def resolve_template_binding(cls, template_key: Optional[str]) -> Optional[Dict[str, Any]]:
        """Resolve a class-level template binding from admin release history or fallback presets."""
        if not template_key:
            return None

        release_history = await cls._load_json_config(cls.RELEASE_HISTORY_KEY, [])
        for release in release_history:
            for template in release.get("templates", []) or []:
                if template.get("id") != template_key:
                    continue
                resolved_snapshot = template.get("resolvedExperimentVersion") or template.get("experimentVersion")
                if not isinstance(resolved_snapshot, dict):
                    continue
                return {
                    "template_key": template_key,
                    "template_label": template.get("label") or resolved_snapshot.get("template_label") or template_key,
                    "template_release_id": release.get("id"),
                    "template_release_note": release.get("note"),
                    "template_source": "admin_release",
                    "template_snapshot": cls.normalize_experiment_version_snapshot(
                        resolved_snapshot,
                        template_key=template_key,
                        template_label=template.get("label") or resolved_snapshot.get("template_label"),
                        template_release_id=release.get("id"),
                        template_release_note=release.get("note"),
                        template_source="admin_release",
                        graph_version=release.get("graphVersion")
                        or (release.get("orchestration") or {}).get("graphVersion"),
                    ),
                }

        working_templates = await cls._load_json_config(cls.TEMPLATE_CONFIG_KEY, [])
        working_orchestration = await cls._load_json_config(cls.ORCHESTRATION_CONFIG_KEY, {})
        for template in working_templates:
            if template.get("id") != template_key:
                continue
            return {
                "template_key": template_key,
                "template_label": template.get("label") or template_key,
                "template_release_id": None,
                "template_release_note": None,
                "template_source": "admin_working_copy",
                "template_snapshot": cls.build_experiment_version_from_template_config(
                    template,
                    graph_version=(working_orchestration or {}).get("graphVersion"),
                    template_source="admin_working_copy",
                ),
            }

        legacy_template = cls.LEGACY_PRESETS.get(template_key)
        if legacy_template:
            return {
                "template_key": template_key,
                "template_label": legacy_template.get("label") or template_key,
                "template_release_id": None,
                "template_release_note": None,
                "template_source": "legacy_builtin",
                "template_snapshot": cls.build_experiment_version_from_template_config(
                    {"id": template_key, **legacy_template},
                    graph_version=None,
                    template_source="legacy_builtin",
                ),
            }

        return None

    @classmethod
    def apply_binding_to_course(cls, course: Course, binding: Dict[str, Any]) -> None:
        """Persist resolved template binding metadata onto a course."""
        bound_at = datetime.utcnow()
        course.experiment_template_key = binding.get("template_key")
        course.experiment_template_label = binding.get("template_label")
        course.experiment_template_release_id = binding.get("template_release_id")
        course.experiment_template_release_note = binding.get("template_release_note")
        course.experiment_template_source = binding.get("template_source")
        course.experiment_template_bound_at = bound_at
        course.experiment_template_snapshot = cls.normalize_experiment_version_snapshot(
            binding.get("template_snapshot"),
            template_key=binding.get("template_key"),
            template_label=binding.get("template_label"),
            template_release_id=binding.get("template_release_id"),
            template_release_note=binding.get("template_release_note"),
            template_source=binding.get("template_source"),
            template_bound_at=bound_at,
        )

    @classmethod
    def clear_course_binding(cls, course: Course) -> None:
        """Clear persisted course template binding metadata."""
        course.experiment_template_key = None
        course.experiment_template_label = None
        course.experiment_template_release_id = None
        course.experiment_template_release_note = None
        course.experiment_template_source = None
        course.experiment_template_bound_at = None
        course.experiment_template_snapshot = None

    @classmethod
    def materialize_project_experiment_version(
        cls,
        project_id: str,
        snapshot: Optional[Dict[str, Any]],
        *,
        source_course_id: Optional[str] = None,
        template_bound_at: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        """Convert a stored template snapshot into a project-specific experiment-version payload."""
        return cls.normalize_experiment_version_snapshot(
            snapshot,
            project_id=project_id,
            source_course_id=source_course_id,
            template_bound_at=template_bound_at,
        )

    @classmethod
    def build_experiment_version_from_template_config(
        cls,
        template: Dict[str, Any],
        *,
        graph_version: Optional[str],
        template_source: str,
    ) -> Dict[str, Any]:
        """Derive a full experiment-version payload from a compact admin template config."""
        template_key = str(template.get("id") or template.get("version_name") or "default").strip()
        template_label = str(template.get("label") or template.get("teacherSummary") or template_key).strip()
        ai_mode = str(template.get("aiMode") or template.get("ai_scaffold_mode") or "multi_agent").strip() or "multi_agent"
        process_mode = str(template.get("processMode") or template.get("process_scaffold_mode") or "on").strip() or "on"
        group_condition = template.get("groupCondition") or template.get("group_condition")
        rule_set = template.get("ruleSet") or template.get("enabled_rule_set")
        stage_sequence = list(template.get("stageSequence") or template.get("stage_sequence") or [])
        current_stage = template.get("currentStage") or template.get("current_stage") or (stage_sequence[0] if stage_sequence else None)
        enabled_layers = template.get("enabled_scaffold_layers") or cls._derive_enabled_scaffold_layers(process_mode)
        enabled_roles = template.get("enabled_scaffold_roles") or cls._derive_enabled_scaffold_roles(ai_mode, process_mode)

        payload = cls._build_base_experiment_version()
        payload.update(
            {
                "mode": "research",
                "version_name": template_key,
                "stage_control_mode": template.get("stageControlMode")
                or template.get("stage_control_mode")
                or "soft_guidance",
                "process_scaffold_mode": process_mode,
                "ai_scaffold_mode": ai_mode,
                "broadcast_stage_updates": bool(
                    template.get("broadcastStageUpdates")
                    if "broadcastStageUpdates" in template
                    else template.get("broadcast_stage_updates", True)
                ),
                "group_condition": group_condition,
                "enabled_scaffold_layers": list(enabled_layers),
                "enabled_scaffold_roles": list(enabled_roles),
                "enabled_rule_set": rule_set,
                "export_profile": template.get("exportProfile") or template.get("export_profile") or "group-stage-features",
                "stage_sequence": stage_sequence,
                "current_stage": current_stage,
                "template_key": template_key,
                "template_label": template_label,
                "template_source": template_source,
                "graph_version": graph_version,
            }
        )
        return payload

    @classmethod
    def normalize_experiment_version_snapshot(
        cls,
        snapshot: Optional[Dict[str, Any]],
        *,
        project_id: Optional[str] = None,
        template_key: Optional[str] = None,
        template_label: Optional[str] = None,
        template_release_id: Optional[str] = None,
        template_release_note: Optional[str] = None,
        template_source: Optional[str] = None,
        graph_version: Optional[str] = None,
        source_course_id: Optional[str] = None,
        template_bound_at: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        """Normalize stored experiment-version snapshots and attach source metadata."""
        payload = cls._build_base_experiment_version()
        if isinstance(snapshot, dict):
            payload.update(deepcopy(snapshot))

        if project_id is not None:
            payload["project_id"] = project_id
        else:
            payload["project_id"] = payload.get("project_id")

        payload["enabled_scaffold_layers"] = list(payload.get("enabled_scaffold_layers") or [])
        payload["enabled_scaffold_roles"] = list(payload.get("enabled_scaffold_roles") or [])
        payload["stage_sequence"] = list(payload.get("stage_sequence") or [])

        if payload.get("current_stage") is None and payload["stage_sequence"]:
            payload["current_stage"] = payload["stage_sequence"][0]

        if template_key is not None:
            payload["template_key"] = template_key
        if template_label is not None:
            payload["template_label"] = template_label
        if template_release_id is not None:
            payload["template_release_id"] = template_release_id
        if template_release_note is not None:
            payload["template_release_note"] = template_release_note
        if template_source is not None:
            payload["template_source"] = template_source
        if graph_version is not None:
            payload["graph_version"] = graph_version
        if source_course_id is not None:
            payload["source_course_id"] = source_course_id
        if template_bound_at is not None:
            payload["template_bound_at"] = template_bound_at

        if not payload.get("template_key"):
            payload["template_key"] = payload.get("version_name")
        if not payload.get("template_label"):
            payload["template_label"] = payload.get("version_name")

        return payload

    @classmethod
    async def _load_json_config(cls, key: str, fallback: Any) -> Any:
        config = await SystemConfig.find_one(SystemConfig.key == key)
        if not config or not config.value:
            return deepcopy(fallback)
        try:
            return json.loads(config.value)
        except json.JSONDecodeError:
            return deepcopy(fallback)

    @classmethod
    def _build_base_experiment_version(cls) -> Dict[str, Any]:
        return {
            "project_id": None,
            "mode": "default",
            "version_name": "default",
            "stage_control_mode": "soft_guidance",
            "process_scaffold_mode": "on",
            "ai_scaffold_mode": "multi_agent",
            "broadcast_stage_updates": True,
            "group_condition": None,
            "enabled_scaffold_layers": [],
            "enabled_scaffold_roles": [],
            "enabled_rule_set": None,
            "export_profile": None,
            "stage_sequence": [],
            "current_stage": None,
            "updated_at": None,
            "template_key": None,
            "template_label": None,
            "template_release_id": None,
            "template_release_note": None,
            "template_source": None,
            "graph_version": None,
            "source_course_id": None,
            "template_bound_at": None,
        }

    @classmethod
    def _derive_enabled_scaffold_layers(cls, process_mode: str) -> list[str]:
        layers = ["multi_agent_scaffold"]
        if process_mode == "on":
            layers.append("process_scaffold")
        return layers

    @classmethod
    def _derive_enabled_scaffold_roles(cls, ai_mode: str, process_mode: str) -> list[str]:
        if ai_mode == "single_agent" and process_mode == "off":
            return ["cognitive_support"]
        return list(cls.ALL_SCAFFOLD_ROLES)


research_config_service = ResearchConfigService()
