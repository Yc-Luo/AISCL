"""Database models (repositories) using Beanie ODM."""

# User management models
from .user import User, UserSettings

# Project management models
from .project import Project, ProjectMember

# Content models
from .document import Document, DocumentVersion
from .collaboration_snapshot import CollaborationSnapshot
from .resource import Resource
from .web_annotation import WebAnnotation

# Collaboration models
from .task import Task
from .calendar_event import CalendarEvent
from .chat_log import ChatLog
from .doc_comment import DocComment

# AI models
from .ai_conversation import AIConversation
from .ai_message import AIMessage
from .ai_role import AIRole
from .ai_intervention_rule import AIInterventionRule

# Analytics models
from .activity_log import ActivityLog
from .analytics_daily_stats import AnalyticsDailyStats
from .research_event import ResearchEvent

# Course management models
from .course import Course

# System models
from .refresh_token import RefreshToken
from .system_config import SystemConfig
from .system_log import SystemLog

__all__ = [
    # User management
    "User", "UserSettings",
    # Project management
    "Project", "ProjectMember",
    # Content
    "Document", "DocumentVersion", "CollaborationSnapshot", "Resource", "WebAnnotation",
    # Collaboration
    "Task", "CalendarEvent", "ChatLog", "DocComment",
    # AI
    "AIConversation", "AIMessage", "AIRole", "AIInterventionRule",
    # Analytics
    "ActivityLog", "AnalyticsDailyStats", "ResearchEvent",
    # Course management
    "Course",
    # System
    "RefreshToken", "SystemConfig", "SystemLog"
]
