"""Room mapping service for dual-channel WebSocket architecture.

This service manages the mapping between Socket.IO rooms (project-level)
and Y.js rooms (resource-level) for real-time collaboration.
"""

import logging
from typing import Dict, List, Optional

from app.repositories.project import Project
from app.repositories.document import Document
from app.repositories.user import User

logger = logging.getLogger(__name__)


# Room prefix constants
SOCKETIO_ROOM_PREFIX = "project:"
YJS_WHITEBOARD_PREFIX = "wb:"
YJS_DOCUMENT_PREFIX = "doc:"
YJS_INQUIRY_PREFIX = "inquiry:"


def get_room_mapping(project_id: str) -> Dict[str, any]:
    """Get room mapping for a project.

    Args:
        project_id: The project ID

    Returns:
        Dictionary containing:
        - socketio_room: Socket.IO room ID (project:{project_id})
        - yjs_rooms: List of Y.js room IDs for this project
        - project_id: The project ID
    """
    socketio_room = f"{SOCKETIO_ROOM_PREFIX}{project_id}"
    yjs_whiteboard_room = f"{YJS_WHITEBOARD_PREFIX}{project_id}"

    return {
        "socketio_room": socketio_room,
        "yjs_rooms": [
            yjs_whiteboard_room,
            f"{YJS_INQUIRY_PREFIX}{project_id}",
            # Document rooms will be added dynamically when documents are created
        ],
        "project_id": project_id,
    }


def parse_room_id(room_id: str) -> Dict[str, Optional[str]]:
    """Parse room ID to extract type and resource ID.

    Args:
        room_id: The room ID (e.g., "project:123", "wb:123", "doc:456")

    Returns:
        Dictionary containing:
        - type: Room type ("socketio", "yjs_whiteboard", "yjs_document")
        - project_id: Project ID (if applicable)
        - resource_id: Resource ID (document_id for doc rooms)
    """
    if room_id.startswith(SOCKETIO_ROOM_PREFIX):
        project_id = room_id.replace(SOCKETIO_ROOM_PREFIX, "")
        return {
            "type": "socketio",
            "project_id": project_id,
            "resource_id": None,
        }
    elif room_id.startswith(YJS_WHITEBOARD_PREFIX):
        project_id = room_id.replace(YJS_WHITEBOARD_PREFIX, "")
        return {
            "type": "yjs_whiteboard",
            "project_id": project_id,
            "resource_id": None,
        }
    elif room_id.startswith(YJS_INQUIRY_PREFIX):
        project_id = room_id.replace(YJS_INQUIRY_PREFIX, "")
        return {
            "type": "yjs_inquiry",
            "project_id": project_id,
            "resource_id": None,
        }
    elif room_id.startswith(YJS_DOCUMENT_PREFIX):
        document_id = room_id.replace(YJS_DOCUMENT_PREFIX, "")
        # For document rooms, we need to look up the project_id from the document
        # This will be implemented when document model is created
        return {
            "type": "yjs_document",
            "project_id": None,  # Will be resolved from document
            "resource_id": document_id,
        }
    else:
        return {
            "type": "unknown",
            "project_id": None,
            "resource_id": None,
        }


async def validate_room_access(room_id: str, user_id: str) -> bool:
    """Validate if a user has access to a room.

    Args:
        room_id: The room ID to validate
        user_id: The user ID to check

    Returns:
        True if user has access, False otherwise
    """
    try:
        parsed = parse_room_id(room_id)

        if parsed["type"] == "unknown":
            logger.warning(f"Unknown room type for room_id: {room_id}")
            return False

        # Get user
        user = await User.get(user_id)
        if not user:
            logger.warning(f"User not found: {user_id}")
            return False

        # Admin and teacher have access to all rooms
        if user.role in ["admin", "teacher"]:
            logger.debug(f"Admin/Teacher access granted for user {user_id} to room {room_id}")
            return True

        # For Socket.IO and Y.js whiteboard rooms, check project membership
        if parsed["type"] in ["socketio", "yjs_whiteboard", "yjs_inquiry"]:
            project_id = parsed["project_id"]
            if not project_id:
                logger.warning(f"No project_id found for room: {room_id}")
                return False

            project = await Project.get(project_id)
            if not project:
                logger.warning(f"Project not found: {project_id}")
                return False

            from app.core.permissions import check_project_member_permission
            has_access = await check_project_member_permission(user, project)
            if has_access:
                logger.debug(f"Access granted for user {user_id} to project room {room_id}")
            else:
                logger.warning(f"Access denied for user {user_id} to project room {room_id}")
            return has_access

        # For Y.js document rooms, check document access
        elif parsed["type"] == "yjs_document":
            document_id = parsed["resource_id"]
            if not document_id:
                logger.warning(f"No document_id found for room: {room_id}")
                return False

            # Check document access
            document = await Document.get(document_id)
            if not document:
                logger.warning(f"Document not found: {document_id}")
                return False

            # Check project access
            project = await Project.get(document.project_id)
            if not project:
                logger.warning(f"Project not found for document: {document.project_id}")
                return False

            from app.core.permissions import check_project_member_permission
            has_access = await check_project_member_permission(user, project)
            if has_access:
                logger.debug(f"Access granted for user {user_id} to document {document_id} (project {document.project_id})")
            else:
                logger.warning(f"Access denied for user {user_id} to document {document_id}")
            return has_access

        logger.warning(f"Unhandled room type: {parsed['type']}")
        return False

    except Exception as e:
        logger.error(f"Error validating room access for user {user_id} to room {room_id}: {str(e)}")
        return False


def get_socketio_room(project_id: str) -> str:
    """Get Socket.IO room ID for a project.

    Args:
        project_id: The project ID

    Returns:
        Socket.IO room ID (project:{project_id})
    """
    return f"{SOCKETIO_ROOM_PREFIX}{project_id}"


def get_yjs_whiteboard_room(project_id: str) -> str:
    """Get Y.js whiteboard room ID for a project.

    Args:
        project_id: The project ID

    Returns:
        Y.js whiteboard room ID (wb:{project_id})
    """
    return f"{YJS_WHITEBOARD_PREFIX}{project_id}"


def get_yjs_document_room(document_id: str) -> str:
    """Get Y.js document room ID for a document.

    Args:
        document_id: The document ID

    Returns:
        Y.js document room ID (doc:{document_id})
    """
    return f"{YJS_DOCUMENT_PREFIX}{document_id}"


def get_yjs_inquiry_room(project_id: str) -> str:
    """Get Y.js inquiry room ID for a project.

    Args:
        project_id: The project ID

    Returns:
        Y.js inquiry room ID (inquiry:{project_id})
    """
    return f"{YJS_INQUIRY_PREFIX}{project_id}"


def extract_project_id_from_room(room_id: str) -> Optional[str]:
    """Extract project ID from a room ID.

    Args:
        room_id: The room ID

    Returns:
        Project ID if found, None otherwise
    """
    parsed = parse_room_id(room_id)
    return parsed.get("project_id")

