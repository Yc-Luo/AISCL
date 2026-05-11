"""Project management API routes."""

import logging
import secrets
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status

from app.api.v1.auth import get_current_user
from app.core.config import settings
from app.core.permissions import check_project_member_permission, is_teacher_project_scope
from app.core.schemas.experiment_version import (
    ExperimentVersionResponse,
    ExperimentVersionUpdateRequest,
)
from app.repositories.project import Project
from app.repositories.user import User
from app.core.schemas.project import (
    ProjectCreateRequest,
    ProjectJoinRequest,
    ProjectListResponse,
    ProjectMemberAddRequest,
    ProjectResponse,
    ProjectUpdateRequest,
)
from app.repositories.course import Course
from app.services.project_service import project_service

router = APIRouter(prefix="/projects", tags=["projects"])
logger = logging.getLogger(__name__)


async def ensure_project_access(current_user: User, project: Project) -> None:
    """Ensure current user can access project."""
    if not await check_project_member_permission(current_user, project):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to access this project",
        )


async def ensure_project_staff_access(current_user: User, project: Project, detail: str) -> None:
    """Ensure current user can manage a project as owner/admin/scoped teacher."""
    if (
        current_user.role == "admin"
        or str(current_user.id) == project.owner_id
        or await is_teacher_project_scope(current_user, project)
    ):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


async def has_project_stage_control_access(current_user: User, project: Project) -> bool:
    """Return whether the user can advance the learning stage for a group.

    In teacher-created groups, project ownership stays with the teacher. The
    first student member is treated as the temporary group leader until an
    explicit leader-selection UI is added.
    """
    if (
        current_user.role == "admin"
        or str(current_user.id) == project.owner_id
        or await is_teacher_project_scope(current_user, project)
    ):
        return True

    current_user_id = str(current_user.id)
    if project.leader_id:
        return project.leader_id == current_user_id

    if any(
        member.get("user_id") == current_user_id and member.get("role") == "owner"
        for member in project.members
    ):
        return True

    student_members = [
        member
        for member in project.members
        if member.get("user_id") and member.get("user_id") != project.owner_id
    ]
    return bool(student_members and student_members[0].get("user_id") == current_user_id)


async def refresh_stage_memory_after_transition(project_id: str, previous_stage: str) -> None:
    """Refresh previous-stage memory without blocking the stage-switch request."""
    try:
        from app.services.group_memory_service import group_memory_service

        await group_memory_service.maybe_refresh_stage_memory(
            project_id=project_id,
            group_id=f"project:{project_id}",
            stage_id=previous_stage,
            trigger="stage_transition",
        )
    except Exception as exc:
        logger.warning(
            "Failed to refresh stage memory after stage transition: project_id=%s stage_id=%s error=%s",
            project_id,
            previous_stage,
            exc,
        )


def _resolve_next_group_leader(project: Project) -> Optional[str]:
    """Return a safe fallback student leader for legacy or changed groups."""
    for member in project.members:
        user_id = member.get("user_id")
        if user_id and user_id != project.owner_id:
            return user_id
    return None


def generate_group_code() -> str:
    """Generate a short group code for student self-joining."""
    return secrets.token_hex(3).upper()[:6]


async def generate_unique_group_code(course_id: str) -> str:
    """Generate a course-scoped unique group code."""
    group_code = generate_group_code()
    while await Project.find_one({"course_id": course_id, "group_code": group_code}):
        group_code = generate_group_code()
    return group_code


def build_project_response(project: Project) -> ProjectResponse:
    """Build a project response without repeating field mapping in each route."""
    return ProjectResponse(
        id=str(project.id),
        name=project.name,
        subtitle=project.subtitle,
        description=project.description,
        course_id=project.course_id,
        group_code=project.group_code,
        owner_id=project.owner_id,
        leader_id=project.leader_id,
        members=[
            {
                "user_id": m.get("user_id"),
                "role": m.get("role"),
                "joined_at": m.get("joined_at"),
            }
            for m in project.members
        ],
        progress=project.progress,
        is_template=project.is_template,
        is_archived=project.is_archived,
        inherited_template_key=project.inherited_template_key,
        inherited_template_label=project.inherited_template_label,
        inherited_template_release_id=project.inherited_template_release_id,
        inherited_template_source=project.inherited_template_source,
        initial_task_document_id=project.initial_task_document_id,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


async def validate_project_leader(project: Project, leader_id: Optional[str]) -> Optional[str]:
    """Validate that a leader is a student who belongs to the project."""
    if not leader_id:
        return None
    if not any(member.get("user_id") == leader_id for member in project.members):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Group leader must be a current project member",
        )
    leader = await User.get(leader_id)
    if not leader or leader.role != "student":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Group leader must be a student account",
        )
    return leader_id


@router.get("", response_model=ProjectListResponse)
async def get_projects(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    archived: Optional[bool] = None,
    current_user: User = Depends(get_current_user),
) -> ProjectListResponse:
    """Get current user's projects."""
    query = {}

    # Filter by user participation
    if current_user.role == "student":
        # Students can only see projects they're members of
        query["$or"] = [
            {"owner_id": str(current_user.id)},
            {"members.user_id": str(current_user.id)},
        ]
    elif current_user.role == "teacher":
        teacher_courses = await Course.find(Course.teacher_id == str(current_user.id)).to_list()
        teacher_course_ids = [str(course.id) for course in teacher_courses]
        query["$or"] = [
            {"owner_id": str(current_user.id)},
            {"members.user_id": str(current_user.id)},
            {"course_id": {"$in": teacher_course_ids}},
        ]
    # Admins can see all projects

    if archived is not None:
        query["is_archived"] = archived

    projects_cursor = Project.find(query).skip(skip).limit(limit)
    projects_list = await projects_cursor.to_list()
    total = await Project.find(query).count()

    return ProjectListResponse(
        projects=[
            build_project_response(p)
            for p in projects_list
        ],
        total=total,
    )


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    project_data: ProjectCreateRequest,
    current_user: User = Depends(get_current_user),
) -> ProjectResponse:
    """Create a new project."""
    course = None
    if project_data.course_id:
        course = await Course.get(project_data.course_id)
        if not course:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Course not found",
            )
        if current_user.role == "teacher" and course.teacher_id != str(current_user.id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to use this course",
            )
        if current_user.role == "student" and (
            current_user.class_id != str(course.id)
            and str(current_user.id) not in course.students
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Students can only create groups inside their joined class",
            )
    elif current_user.role == "student":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Students must create groups inside a joined class",
        )

    # Check student project limit (only 1 project per student)
    if current_user.role == "student":
        existing_projects = await Project.find(
            {
                "$or": [
                    {"owner_id": str(current_user.id)},
                    {"members.user_id": str(current_user.id)},
                ],
                "is_archived": False,
            }
        ).to_list()
        if len(existing_projects) >= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Students can only join 1 project",
            )

    # Create project
    from datetime import datetime

    initial_members = []
    initial_leader_id = None
    if current_user.role == "student":
        initial_leader_id = str(current_user.id)
        initial_members.append(
            {
                "user_id": str(current_user.id),
                "role": "owner",
                "joined_at": datetime.utcnow(),
            }
        )

    new_project = Project(
        name=project_data.name,
        subtitle=project_data.subtitle,
        description=project_data.description,
        course_id=project_data.course_id,
        group_code=await generate_unique_group_code(project_data.course_id) if project_data.course_id else None,
        owner_id=str(current_user.id),
        leader_id=initial_leader_id,
        members=initial_members,
    )
    await new_project.insert()

    if course:
        await project_service.initialize_project_from_course(
            project=new_project,
            course=course,
            owner_id=str(current_user.id),
            inherit_course_template=project_data.inherit_course_template,
        )
        new_project = await Project.get(str(new_project.id))
        if not new_project:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Project initialization failed",
            )

    return build_project_response(new_project)


@router.post("/join", response_model=ProjectResponse)
async def join_project_by_group_code(
    join_data: ProjectJoinRequest,
    current_user: User = Depends(get_current_user),
) -> ProjectResponse:
    """Join a course-scoped project group using its group code."""
    if current_user.role != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only students can join learning groups",
        )

    course = await Course.get(join_data.course_id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )
    if current_user.class_id != str(course.id) and str(current_user.id) not in course.students:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Students can only join groups inside their own class",
        )

    group_code = join_data.group_code.strip().upper()
    project = await Project.find_one(
        {
            "course_id": str(course.id),
            "group_code": group_code,
            "is_archived": False,
        }
    )
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group code is invalid for this class",
        )

    current_user_id = str(current_user.id)
    if any(member.get("user_id") == current_user_id for member in project.members):
        return build_project_response(project)

    existing_project = await Project.find_one(
        {
            "$or": [
                {"owner_id": current_user_id},
                {"members.user_id": current_user_id},
            ],
            "is_archived": False,
        }
    )
    if existing_project:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Students can only join 1 active project",
        )

    student_member_count = 0
    if project.members:
        import bson

        member_object_ids = [
            bson.ObjectId(member.get("user_id"))
            for member in project.members
            if bson.ObjectId.is_valid(member.get("user_id"))
        ]
        if member_object_ids:
            student_member_count = await User.find(
                {"_id": {"$in": member_object_ids}, "role": "student"}
            ).count()
    if settings.MAX_PROJECT_MEMBERS > 0 and student_member_count >= settings.MAX_PROJECT_MEMBERS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Project can have at most {settings.MAX_PROJECT_MEMBERS} members",
        )

    from datetime import datetime

    project.members.append(
        {
            "user_id": current_user_id,
            "role": "editor",
            "joined_at": datetime.utcnow(),
        }
    )
    await project.save()
    return build_project_response(project)


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
) -> ProjectResponse:
    """Get project details."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Check permission
    await ensure_project_access(current_user, project)

    return build_project_response(project)


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    project_data: ProjectUpdateRequest,
    current_user: User = Depends(get_current_user),
) -> ProjectResponse:
    """Update project (Owner only)."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_staff_access(
        current_user,
        project,
        "Only project owner or scoped teacher can update project",
    )

    from datetime import datetime

    if project_data.name:
        project.name = project_data.name
    if project_data.subtitle is not None:
        project.subtitle = project_data.subtitle
    if project_data.description is not None:
        project.description = project_data.description
    if project_data.progress is not None:
        project.progress = project_data.progress
    if project_data.is_archived is not None:
        project.is_archived = project_data.is_archived
    if "leader_id" in project_data.model_fields_set:
        project.leader_id = await validate_project_leader(project, project_data.leader_id)
    project.updated_at = datetime.utcnow()

    await project.save()

    return ProjectResponse(
        id=str(project.id),
        name=project.name,
        subtitle=project.subtitle,
        description=project.description,
        course_id=project.course_id,
        owner_id=project.owner_id,
        leader_id=project.leader_id,
        members=[
            {
                "user_id": m.get("user_id"),
                "role": m.get("role"),
                "joined_at": m.get("joined_at"),
            }
            for m in project.members
        ],
        progress=project.progress,
        is_template=project.is_template,
        is_archived=project.is_archived,
        inherited_template_key=project.inherited_template_key,
        inherited_template_label=project.inherited_template_label,
        inherited_template_release_id=project.inherited_template_release_id,
        inherited_template_source=project.inherited_template_source,
        initial_task_document_id=project.initial_task_document_id,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete project (Owner only)."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_staff_access(
        current_user,
        project,
        "Only project owner or scoped teacher can delete project",
    )

    await project.delete()


@router.get("/{project_id}/experiment-version", response_model=ExperimentVersionResponse)
async def get_experiment_version(
    project_id: str,
    current_user: User = Depends(get_current_user),
) -> ExperimentVersionResponse:
    """Get experiment-version configuration for a project."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_access(current_user, project)
    payload = await project_service.get_experiment_version(project)
    return ExperimentVersionResponse(**payload)


@router.put("/{project_id}/experiment-version", response_model=ExperimentVersionResponse)
async def update_experiment_version(
    project_id: str,
    version_data: ExperimentVersionUpdateRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
) -> ExperimentVersionResponse:
    """Update experiment-version configuration for a project."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    update_payload = version_data.model_dump(exclude_unset=True)
    requested_keys = set(update_payload.keys())
    is_stage_only_update = requested_keys and requested_keys <= {"current_stage"}

    if is_stage_only_update:
        if not await has_project_stage_control_access(current_user, project):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the group leader, project owner, or scoped teacher can update current stage",
            )

        current_stage = update_payload.get("current_stage")
        stage_sequence = (project.experiment_version or {}).get("stage_sequence") or []
        if current_stage and stage_sequence and current_stage not in stage_sequence:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current stage must be one of the configured stage sequence values",
            )
    else:
        await ensure_project_staff_access(
            current_user,
            project,
            "Only project owner or scoped teacher can update experiment version",
        )

    previous_stage = (project.experiment_version or {}).get("current_stage")
    payload = await project_service.update_experiment_version(
        project, update_payload
    )
    next_stage = payload.get("current_stage")
    if is_stage_only_update and previous_stage and previous_stage != next_stage:
        background_tasks.add_task(
            refresh_stage_memory_after_transition,
            project_id,
            previous_stage,
        )
    return ExperimentVersionResponse(**payload)


@router.post("/{project_id}/members", status_code=status.HTTP_201_CREATED)
async def add_project_member(
    project_id: str,
    member_data: ProjectMemberAddRequest,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Add a member to project (Owner/Editor only)."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Check permission
    is_owner = str(current_user.id) == project.owner_id
    is_editor = any(
        m.get("user_id") == str(current_user.id) and m.get("role") in ["owner", "editor"]
        for m in project.members
    )
    if (
        not (is_owner or is_editor)
        and current_user.role != "admin"
        and not await is_teacher_project_scope(current_user, project)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only owner and editor can invite members",
        )

    # Resolve user
    target_user_id = member_data.user_id
    target_user = None
    if member_data.email:
        target_user = await User.find_one(User.email == member_data.email)
        if not target_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User with this email not found",
            )
        target_user_id = str(target_user.id)
    elif member_data.username:
        target_user = await User.find_one(User.username == member_data.username)
        if not target_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User with this username not found",
            )
        target_user_id = str(target_user.id)
    elif member_data.account:
        account = member_data.account.strip()
        target_user = await User.find_one(
            {
                "$or": [
                    {"email": account},
                    {"username": account},
                    {"phone": account},
                ]
            }
        )
        if not target_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User with this account not found",
            )
        target_user_id = str(target_user.id)
    
    if not target_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either user_id or email must be provided",
        )
    if not target_user:
        target_user = await User.get(target_user_id)
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if target_user.role != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only student accounts can be added to a learning group",
        )

    if current_user.role != "admin":
        if project.course_id and target_user.class_id != project.course_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Students can only be added to groups in their own class",
            )
        if current_user.role == "teacher" and not project.course_id:
            teacher_courses = await Course.find(Course.teacher_id == str(current_user.id)).to_list()
            teacher_course_ids = {str(course.id) for course in teacher_courses}
            if target_user.class_id not in teacher_course_ids:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Teacher can only add students from their own classes",
                )

    # Treat repeated add requests as idempotent. The teacher-side member editor
    # can submit a stale project snapshot after local selection changes; failing
    # on already-existing members makes an otherwise valid save look broken.
    if any(m.get("user_id") == target_user_id for m in project.members):
        return {"message": "Member already exists"}

    existing_target_project = await Project.find_one(
        {
            "$or": [
                {"owner_id": target_user_id},
                {"members.user_id": target_user_id},
            ],
            "is_archived": False,
        }
    )
    if existing_target_project and str(existing_target_project.id) != project_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This student already belongs to another active project",
        )

    # Check member limit only for truly new members.
    student_member_count = 0
    if project.members:
        import bson

        member_object_ids = [
            bson.ObjectId(member.get("user_id"))
            for member in project.members
            if bson.ObjectId.is_valid(member.get("user_id"))
        ]
        if member_object_ids:
            student_member_count = await User.find(
                {"_id": {"$in": member_object_ids}, "role": "student"}
            ).count()

    if settings.MAX_PROJECT_MEMBERS > 0 and student_member_count >= settings.MAX_PROJECT_MEMBERS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Project can have at most {settings.MAX_PROJECT_MEMBERS} members",
        )

    # Add member
    from datetime import datetime

    project.members.append(
        {
            "user_id": target_user_id,
            "role": member_data.role,
            "joined_at": datetime.utcnow(),
        }
    )
    await project.save()

    return {"message": "Member added successfully"}


@router.delete("/{project_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_project_member(
    project_id: str,
    user_id: str,
    current_user: User = Depends(get_current_user),
) -> None:
    """Remove a member from project (Owner only)."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_staff_access(
        current_user,
        project,
        "Only project owner or scoped teacher can remove members",
    )

    # Remove member
    project.members = [m for m in project.members if m.get("user_id") != user_id]
    if project.leader_id == user_id:
        project.leader_id = _resolve_next_group_leader(project)
    await project.save()


@router.post("/{project_id}/archive", response_model=ProjectResponse)
async def archive_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
) -> ProjectResponse:
    """Archive a project (Owner only)."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_staff_access(
        current_user,
        project,
        "Only project owner or scoped teacher can archive project",
    )

    from datetime import datetime

    project.is_archived = True
    project.updated_at = datetime.utcnow()
    await project.save()

    return ProjectResponse(
        id=str(project.id),
        name=project.name,
        subtitle=project.subtitle,
        description=project.description,
        course_id=project.course_id,
        owner_id=project.owner_id,
        leader_id=project.leader_id,
        members=[
            {
                "user_id": m.get("user_id"),
                "role": m.get("role"),
                "joined_at": m.get("joined_at"),
            }
            for m in project.members
        ],
        progress=project.progress,
        is_template=project.is_template,
        is_archived=project.is_archived,
        inherited_template_key=project.inherited_template_key,
        inherited_template_label=project.inherited_template_label,
        inherited_template_release_id=project.inherited_template_release_id,
        inherited_template_source=project.inherited_template_source,
        initial_task_document_id=project.initial_task_document_id,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.post("/{project_id}/unarchive", response_model=ProjectResponse)
async def unarchive_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
) -> ProjectResponse:
    """Unarchive a project (Owner only)."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_staff_access(
        current_user,
        project,
        "Only project owner or scoped teacher can unarchive project",
    )

    from datetime import datetime

    project.is_archived = False
    project.updated_at = datetime.utcnow()
    await project.save()

    return ProjectResponse(
        id=str(project.id),
        name=project.name,
        subtitle=project.subtitle,
        description=project.description,
        course_id=project.course_id,
        owner_id=project.owner_id,
        leader_id=project.leader_id,
        members=[
            {
                "user_id": m.get("user_id"),
                "role": m.get("role"),
                "joined_at": m.get("joined_at"),
            }
            for m in project.members
        ],
        progress=project.progress,
        is_template=project.is_template,
        is_archived=project.is_archived,
        inherited_template_key=project.inherited_template_key,
        inherited_template_label=project.inherited_template_label,
        inherited_template_release_id=project.inherited_template_release_id,
        inherited_template_source=project.inherited_template_source,
        initial_task_document_id=project.initial_task_document_id,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.put("/{project_id}/members/{user_id}/role", response_model=dict)
async def update_member_role(
    project_id: str,
    user_id: str,
    new_role: str = Query(..., pattern="^(owner|editor|viewer)$"),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Update member role (Owner only)."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Only owner can change roles
    if str(current_user.id) != project.owner_id and current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only project owner can change member roles",
        )

    # Find member
    member = next(
        (m for m in project.members if m.get("user_id") == user_id), None
    )
    if not member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found",
        )

    # Update role
    member["role"] = new_role
    await project.save()

    return {"message": "Member role updated successfully"}


@router.post("/{project_id}/transfer-ownership", response_model=ProjectResponse)
async def transfer_ownership(
    project_id: str,
    new_owner_id: str = Query(...),
    current_user: User = Depends(get_current_user),
) -> ProjectResponse:
    """Transfer project ownership (Owner only)."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Only owner can transfer
    if str(current_user.id) != project.owner_id and current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only project owner can transfer ownership",
        )

    # Check if new owner is a member
    member = next(
        (m for m in project.members if m.get("user_id") == new_owner_id), None
    )
    if not member:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New owner must be a project member",
        )

    from datetime import datetime

    # Update old owner role to editor
    old_owner = next(
        (m for m in project.members if m.get("user_id") == project.owner_id), None
    )
    if old_owner:
        old_owner["role"] = "editor"

    # Update new owner role
    member["role"] = "owner"

    # Update project owner
    project.owner_id = new_owner_id
    project.updated_at = datetime.utcnow()
    await project.save()

    return ProjectResponse(
        id=str(project.id),
        name=project.name,
        subtitle=project.subtitle,
        description=project.description,
        course_id=project.course_id,
        owner_id=project.owner_id,
        leader_id=project.leader_id,
        members=[
            {
                "user_id": m.get("user_id"),
                "role": m.get("role"),
                "joined_at": m.get("joined_at"),
            }
            for m in project.members
        ],
        progress=project.progress,
        is_template=project.is_template,
        is_archived=project.is_archived,
        inherited_template_key=project.inherited_template_key,
        inherited_template_label=project.inherited_template_label,
        inherited_template_release_id=project.inherited_template_release_id,
        inherited_template_source=project.inherited_template_source,
        initial_task_document_id=project.initial_task_document_id,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )
