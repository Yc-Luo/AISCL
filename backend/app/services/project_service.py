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

        seeded_document = await ProjectService._create_initial_task_document(
            project=project,
            course=course,
            owner_id=owner_id,
        )
        if seeded_document:
            project.initial_task_document_id = str(seeded_document.id)

        project.updated_at = datetime.utcnow()
        await project.save()

    @staticmethod
    def _resolve_initial_task_document_payload(course: Course) -> Optional[tuple[str, str]]:
        """Return normalized task brief title/content for a course."""
        title = (course.initial_task_document_title or "").strip() or "项目说明"
        content = course.initial_task_document_content or ""
        if not content.strip() and not (course.initial_task_document_title or "").strip():
            return None
        if not content.strip():
            content = title
        return title, content

    @staticmethod
    async def _create_initial_task_document(
        *,
        project: Project,
        course: Course,
        owner_id: str,
    ) -> Optional[Document]:
        """Create the project-scoped task brief document and its Wiki seed item."""
        payload = ProjectService._resolve_initial_task_document_payload(course)
        if not payload:
            return None

        task_title, task_content = payload
        seeded_document = Document(
            project_id=str(project.id),
            title=task_title,
            content=task_content,
            content_state=b"",
            preview_text=task_content[:200] or None,
            last_modified_by=owner_id,
        )
        await seeded_document.insert()

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
        return seeded_document

    @staticmethod
    async def sync_course_initial_task_documents(
        course: Course,
        *,
        owner_id: str,
        previous_title: Optional[str] = None,
        previous_content: Optional[str] = None,
    ) -> Dict[str, int]:
        """Backfill or safely refresh task brief documents for existing course groups.

        Existing student-edited documents are not overwritten. The content is refreshed
        only when the document is still empty or still matches the previous course brief.
        """
        payload = ProjectService._resolve_initial_task_document_payload(course)
        if not payload:
            return {"created": 0, "updated": 0, "skipped": 0}

        task_title, task_content = payload
        projects = await Project.find(Project.course_id == str(course.id)).to_list()
        result = {"created": 0, "updated": 0, "skipped": 0}

        for project in projects:
            existing_document: Optional[Document] = None
            if project.initial_task_document_id:
                try:
                    existing_document = await Document.get(project.initial_task_document_id)
                except Exception:
                    existing_document = None

            if not existing_document:
                seeded_document = await ProjectService._create_initial_task_document(
                    project=project,
                    course=course,
                    owner_id=owner_id,
                )
                if seeded_document:
                    project.initial_task_document_id = str(seeded_document.id)
                    project.updated_at = datetime.utcnow()
                    await project.save()
                    result["created"] += 1
                continue

            previous_title_value = previous_title or ""
            previous_content_value = previous_content or ""
            existing_content = existing_document.content or ""
            should_update_title = (
                not existing_document.title.strip()
                or existing_document.title == previous_title_value
                or existing_document.title == "项目说明"
            )
            should_update_content = (
                not existing_content.strip()
                or (
                    previous_content is not None
                    and existing_content == previous_content_value
                )
            )

            changed = False
            if should_update_title and existing_document.title != task_title:
                existing_document.title = task_title
                changed = True
            if should_update_content and existing_document.content != task_content:
                existing_document.content = task_content
                existing_document.preview_text = task_content[:200] or None
                changed = True

            if changed:
                existing_document.last_modified_by = owner_id
                existing_document.updated_at = datetime.utcnow()
                await existing_document.save()
                result["updated"] += 1
            else:
                result["skipped"] += 1

        return result


project_service = ProjectService()
