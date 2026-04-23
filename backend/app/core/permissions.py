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
    """Check if user has permission to access a project."""
    if user.role in ["admin", "teacher"]:
        return True
    if str(user.id) == project_owner_id:
        return True
    return False


async def check_project_member_permission(user: User, project: Project) -> bool:
    """Check if user is a member of the project with proper permissions.

    Args:
        user: The user to check
        project: The project to check access for

    Returns:
        True if user has access, False otherwise
    """
    # Admin and teacher have access to all projects
    if user.role in ["admin", "teacher"]:
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

    return False


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

