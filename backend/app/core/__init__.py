"""Core application configuration and infrastructure."""

# Configuration
from .config import settings

# Database
from .db.mongodb import mongodb

# Cache
from .cache import get_cache, set_cache, delete_cache, cached

# Security
from .security import (
    sanitize_input,
    validate_password_strength,
    sanitize_filename,
    validate_file_type,
    get_csp_header
)

# Permissions
from .permissions import (
    check_project_permission,
    check_project_member_permission,
    get_user_role_in_project,
    get_user_role_in_project_sync,
    can_edit_collaboration,
    can_edit_document,
    can_manage_members,
    can_upload_resources
)

# Monitoring
from .monitoring import PerformanceMonitor, monitor

# Error handling
from .error_handlers import setup_error_handlers

# Logging
from .logging_config import setup_logging

__all__ = [
    # Configuration
    "settings",
    # Database
    "mongodb",
    # Cache
    "get_cache", "set_cache", "delete_cache", "cached",
    # Security
    "sanitize_input", "validate_password_strength", "sanitize_filename",
    "validate_file_type", "get_csp_header",
    # Permissions
    "check_project_permission", "check_project_member_permission",
    "get_user_role_in_project", "get_user_role_in_project_sync",
    "can_edit_collaboration", "can_edit_document", "can_manage_members",
    "can_upload_resources",
    # Monitoring
    "PerformanceMonitor", "monitor",
    # Error handling
    "setup_error_handlers",
    # Logging
    "setup_logging"
]

