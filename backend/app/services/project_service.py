"""Project-level service extensions for experiment-mode support."""

from datetime import datetime
from typing import Any, Dict, Optional

from app.repositories.course import Course
from app.repositories.document import Document
from app.repositories.project import Project
from app.services.research_config_service import research_config_service


class ProjectService:
    """Service for project operations beyond basic CRUD routes."""

    @staticmethod
    def build_default_experiment_version(project_id: str) -> Dict[str, Any]:
        """Build default experiment-version payload for a project."""
        return {
            "project_id": project_id,
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
            "template_key": None,
            "template_label": None,
            "template_release_id": None,
            "template_release_note": None,
            "template_source": None,
            "graph_version": None,
            "source_course_id": None,
            "template_bound_at": None,
            "updated_at": None,
        }

    @staticmethod
    def build_named_experiment_template(project_id: str, template_key: Optional[str]) -> Dict[str, Any]:
        """Build a predefined experiment template by key."""
        binding = research_config_service.LEGACY_PRESETS.get(template_key or "")
        if not binding:
            return ProjectService.build_default_experiment_version(project_id)
        return research_config_service.materialize_project_experiment_version(
            project_id,
            research_config_service.build_experiment_version_from_template_config(
                {"id": template_key, **binding},
                graph_version=None,
                template_source="legacy_builtin",
            ),
        )

    @staticmethod
    async def get_experiment_version(project: Project) -> Dict[str, Any]:
        """Return project experiment-version payload with safe default."""
        if not project.experiment_version:
            return ProjectService.build_default_experiment_version(str(project.id))

        payload = ProjectService.build_default_experiment_version(str(project.id))
        payload.update(dict(project.experiment_version))
        payload["project_id"] = str(project.id)
        return payload

    @staticmethod
    async def update_experiment_version(project: Project, data: Dict[str, Any]) -> Dict[str, Any]:
        """Persist experiment-version payload on project."""
        experiment_version = ProjectService.build_default_experiment_version(str(project.id))
        if project.experiment_version:
            experiment_version.update(dict(project.experiment_version))
        experiment_version.update(dict(data))
        experiment_version["project_id"] = str(project.id)
        experiment_version["updated_at"] = datetime.utcnow()
        project.experiment_version = experiment_version
        project.updated_at = datetime.utcnow()
        await project.save()
        experiment_version["project_id"] = str(project.id)
        return experiment_version

    @staticmethod
    async def initialize_project_from_course(
        project: Project,
        course: Course,
        owner_id: str,
        inherit_course_template: bool,
    ) -> None:
        """Apply course template and seed initial task document for a new group space."""
        project.course_id = str(course.id)

        if inherit_course_template and course.experiment_template_key:
            if course.experiment_template_snapshot:
                project.experiment_version = research_config_service.materialize_project_experiment_version(
                    str(project.id),
                    course.experiment_template_snapshot,
                    source_course_id=str(course.id),
                    template_bound_at=course.experiment_template_bound_at,
                )
            else:
                binding = await research_config_service.resolve_template_binding(course.experiment_template_key)
                if binding:
                    project.experiment_version = research_config_service.materialize_project_experiment_version(
                        str(project.id),
                        binding.get("template_snapshot"),
                        source_course_id=str(course.id),
                    )
                else:
                    project.experiment_version = ProjectService.build_named_experiment_template(
                        str(project.id),
                        course.experiment_template_key,
                    )
            project.inherited_template_key = course.experiment_template_key
            project.inherited_template_label = course.experiment_template_label
            project.inherited_template_release_id = course.experiment_template_release_id
            project.inherited_template_source = course.experiment_template_source

        if course.initial_task_document_title or course.initial_task_document_content:
            task_title = course.initial_task_document_title or "项目说明"
            task_content = course.initial_task_document_content or task_title
            seeded_document = Document(
                project_id=str(project.id),
                title=task_title,
                content=task_content,
                content_state=b"",
                preview_text=task_content[:200] or None,
                last_modified_by=owner_id,
            )
            await seeded_document.insert()
            project.initial_task_document_id = str(seeded_document.id)

            from app.services.wiki_service import wiki_service

            await wiki_service.create_item(
                {
                    "project_id": str(project.id),
                    "item_type": "task_brief",
                    "title": task_title,
                    "content": task_content,
                    "summary": task_content[:500],
                    "source_type": "teacher_brief",
                    "source_id": str(seeded_document.id),
                    "visibility": "project",
                    "confidence_level": "verified",
                },
                current_user_id=owner_id,
                actor_type="teacher",
            )

        project.updated_at = datetime.utcnow()
        await project.save()


project_service = ProjectService()
