"""Permission checking utilities."""

import logging
from typing import Dict, List, Optional

from app.repositories.project import Project
from app.repositories.user import User
from app.services.cache_service import cache_service

logger = logging.getLogger(__name__)


def check_project_permission(
    user: User, project_owner_id: str, user_role: str
) -> bool:
    """Check project access that does not require database lookup."""
    if user.role == "admin":
        return True
    if str(user.id) == project_owner_id:
        return True
    return False


def is_project_member(user: User, project: Project) -> bool:
    """Return whether the user is explicitly listed as a project member."""
    return any(member.get("user_id") == str(user.id) for member in project.members)


def is_project_editor(user: User, project: Project) -> bool:
    """Return whether the user is an owner/editor member of the project."""
    if str(user.id) == project.owner_id:
        return True
    return any(
        member.get("user_id") == str(user.id)
        and member.get("role") in ["owner", "editor"]
        for member in project.members
    )


async def is_teacher_project_scope(user: User, project: Project) -> bool:
    """Return whether a teacher can access the project through their course."""
    if user.role != "teacher":
        return False
    if str(user.id) == project.owner_id or is_project_member(user, project):
        return True
    if not project.course_id:
        return False

    from app.repositories.course import Course

    course = await Course.get(project.course_id)
    return bool(course and course.teacher_id == str(user.id))


async def check_project_member_permission(user: User, project: Project) -> bool:
    """Check if user is a member of the project with proper permissions.

    Args:
        user: The user to check
        project: The project to check access for

    Returns:
        True if user has access, False otherwise
    """
    # Admin has global access.
    if user.role == "admin":
        return True

    # Owner has full access
    if str(user.id) == project.owner_id:
        return True

    # Check if user is a member
    for member in project.members:
        if member.get("user_id") == str(user.id):
            member_role = member.get("role", "viewer")
            # All member roles (viewer, editor, owner) have access to the project
            return True

    if await is_teacher_project_scope(user, project):
        return True

    return False


async def can_edit_project_content(user: User, project: Project) -> bool:
    """Return whether user can edit shared project content."""
    if user.role == "admin":
        return True
    if is_project_editor(user, project):
        return True
    return await is_teacher_project_scope(user, project)


async def can_manage_project_scope(user: User, project: Project) -> bool:
    """Return whether user can manage project-level settings and exports."""
    if user.role == "admin":
        return True
    if str(user.id) == project.owner_id:
        return True
    return await is_teacher_project_scope(user, project)


async def get_user_role_in_project(user: User, project: Project) -> str:
    """Get the role of a user in a project.

    Args:
        user: The user to check
        project: The project to check

    Returns:
        Role string: "admin", "teacher", "owner", "editor", "viewer", or "none"
    """
    # Admin and teacher override project roles
    if user.role == "admin":
        return "admin"
    if user.role == "teacher":
        return "teacher"

    # Check project ownership
    if str(user.id) == project.owner_id:
        return "owner"

    # Check membership
    for member in project.members:
        if member.get("user_id") == str(user.id):
            return member.get("role", "viewer")

    return "none"


def get_user_role_in_project_sync(user: User, project: Project) -> str:
    """Synchronous version of get_user_role_in_project for backward compatibility.

    Args:
        user: The user to check
        project: The project to check

    Returns:
        Role string: "admin", "teacher", "owner", "editor", "viewer", or "none"
    """
    # Admin and teacher override project roles
    if user.role == "admin":
        return "admin"
    if user.role == "teacher":
        return "teacher"

    # Check project ownership
    if str(user.id) == project.owner_id:
        return "owner"

    # Check membership
    for member in project.members:
        if member.get("user_id") == str(user.id):
            return member.get("role", "viewer")

    return "none"


def can_edit_collaboration(user_role: str) -> bool:
    """Check if user role can edit collaboration resources.

    Args:
        user_role: User's role in the project

    Returns:
        True if can edit, False otherwise
    """
    return user_role in ["admin", "teacher", "owner", "editor"]


def can_edit_document(user_role: str) -> bool:
    """Check if user role can edit document.

    Args:
        user_role: User's role in the project

    Returns:
        True if can edit, False otherwise
    """
    return user_role in ["admin", "teacher", "owner", "editor"]


def can_manage_members(user_role: str) -> bool:
    """Check if user role can manage project members.

    Args:
        user_role: User's role in the project

    Returns:
        True if can manage members, False otherwise
    """
    return user_role in ["admin", "teacher", "owner"]


def can_upload_resources(user_role: str) -> bool:
    """Check if user role can upload resources.

    Args:
        user_role: User's role in the project

    Returns:
        True if can upload, False otherwise
    """
    return user_role in ["admin", "teacher", "owner", "editor"]


def can_delete_project(user_role: str) -> bool:
    """Check if user role can delete the project.

    Args:
        user_role: User's role in the project

    Returns:
        True if can delete, False otherwise
    """
    return user_role in ["admin", "teacher", "owner"]
