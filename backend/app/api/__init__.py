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
    ai,
    admin,
    inquiry,
    wiki,
)

__all__ = [
    "auth", "users", "projects", "storage", "courses", "tasks",
    "calendar", "documents", "comments", "collaboration", "chat",
    "analytics", "ai", "admin", "inquiry", "wiki"
]
