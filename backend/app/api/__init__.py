"""API routes and endpoints."""

# Import all API routers for easy access
from .v1 import (
    auth,
    users,
    projects,
    storage,
    courses,
    tasks,
    calendar,
    documents,
    comments,
    collaboration,
    chat,
    analytics,
    # ai,  # Temporarily disabled due to missing dependencies
    web_annotations,
    admin
)

__all__ = [
    "auth", "users", "projects", "storage", "courses", "tasks",
    "calendar", "documents", "comments", "collaboration", "chat",
    "analytics", 
    # "ai",  # Temporarily disabled
    "web_annotations", "admin"
]

