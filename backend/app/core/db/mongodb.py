"""MongoDB connection using Motor and Beanie."""

from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import settings


class MongoDB:
    """MongoDB connection manager."""

    client: AsyncIOMotorClient | None = None

    @classmethod
    async def connect(cls) -> None:
        """Connect to MongoDB and initialize Beanie."""
        cls.client = AsyncIOMotorClient(
            settings.MONGODB_URI,
            maxPoolSize=settings.MONGODB_MAX_POOL_SIZE,
        )
        database = cls.client[settings.MONGODB_DB_NAME]

        # Import all document models here to register them with Beanie
        from app.repositories.user import User
        from app.repositories.refresh_token import RefreshToken
        from app.repositories.project import Project
        from app.repositories.collaboration_snapshot import CollaborationSnapshot
        from app.repositories.chat_log import ChatLog
        from app.repositories.task import Task
        from app.repositories.calendar_event import CalendarEvent
        from app.repositories.resource import Resource
        from app.repositories.ai_conversation import AIConversation
        from app.repositories.ai_message import AIMessage
        from app.repositories.activity_log import ActivityLog
        from app.repositories.research_event import ResearchEvent
        from app.repositories.course import Course
        from app.repositories.document import Document, DocumentVersion
        from app.repositories.doc_comment import DocComment
        from app.repositories.analytics_daily_stats import AnalyticsDailyStats
        from app.repositories.ai_role import AIRole
        from app.repositories.ai_intervention_rule import AIInterventionRule
        from app.repositories.web_annotation import WebAnnotation
        from app.repositories.system_config import SystemConfig
        from app.repositories.system_log import SystemLog
        from app.repositories.resource_embedding import ResourceEmbedding
        from app.repositories.dashboard_snapshot import DashboardSnapshot
        from app.repositories.inquiry_snapshot import InquirySnapshot
        from app.repositories.wiki_item import WikiItem

        await init_beanie(
            database=database,
            document_models=[
                User,
                RefreshToken,
                Project,
                CollaborationSnapshot,
                ChatLog,
                Task,
                CalendarEvent,
                Resource,
                AIConversation,
                AIMessage,
                ActivityLog,
                ResearchEvent,
                Course,
                Document,
                DocumentVersion,
                DocComment,
                AnalyticsDailyStats,
                AIRole,
                AIInterventionRule,
                WebAnnotation,
                SystemConfig,
                SystemLog,
                ResourceEmbedding,
                DashboardSnapshot,
                InquirySnapshot,
                WikiItem,
            ],
            recreate_views=False,  # Prevent index recreation conflicts
        )

    @classmethod
    def get_database(cls):
        """Get the database instance."""
        if cls.client is None:
            raise RuntimeError("MongoDB client is not initialized. Call connect() first.")
        return cls.client[settings.MONGODB_DB_NAME]

    @classmethod
    async def disconnect(cls) -> None:
        """Disconnect from MongoDB."""
        if cls.client:
            cls.client.close()
            cls.client = None


mongodb = MongoDB()
