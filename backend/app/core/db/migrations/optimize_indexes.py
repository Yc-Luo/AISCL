"""Migration script to optimize database indexes."""

import asyncio
from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import settings


async def optimize_indexes():
    """Create and optimize database indexes."""
    client = AsyncIOMotorClient(settings.MONGODB_URI)
    db = client[settings.MONGODB_DB_NAME]

    # Indexes for users collection
    users_collection = db["users"]
    await users_collection.create_index("email", unique=True)
    await users_collection.create_index("username", unique=True)
    await users_collection.create_index("phone", unique=True, sparse=True)
    await users_collection.create_index("role")
    await users_collection.create_index("is_active")
    await users_collection.create_index("is_banned")
    await users_collection.create_index([("role", 1), ("is_active", 1)])
    print("Created indexes for users collection")

    # Indexes for projects collection
    projects_collection = db["projects"]
    await projects_collection.create_index("owner_id")
    await projects_collection.create_index("members.user_id")
    await projects_collection.create_index("is_archived")
    await projects_collection.create_index([("owner_id", 1), ("is_archived", 1)])
    await projects_collection.create_index([("members.user_id", 1), ("is_archived", 1)])
    print("Created indexes for projects collection")

    # Indexes for tasks collection
    tasks_collection = db["tasks"]
    await tasks_collection.create_index("project_id")
    await tasks_collection.create_index([("project_id", 1), ("column", 1)])
    await tasks_collection.create_index([("project_id", 1), ("order", 1)])
    await tasks_collection.create_index("assignees")
    await tasks_collection.create_index("due_date")
    print("Created indexes for tasks collection")

    # Indexes for calendar_events collection
    calendar_collection = db["calendar_events"]
    await calendar_collection.create_index("project_id")
    await calendar_collection.create_index([("project_id", 1), ("start_time", 1)])
    await calendar_collection.create_index("created_by")
    await calendar_collection.create_index("start_time")
    print("Created indexes for calendar_events collection")

    # Indexes for chat_logs collection
    chat_logs_collection = db["chat_logs"]
    await chat_logs_collection.create_index("project_id")
    await chat_logs_collection.create_index([("project_id", 1), ("created_at", -1)])
    await chat_logs_collection.create_index("user_id")
    await chat_logs_collection.create_index("mentions")
    print("Created indexes for chat_logs collection")

    # Indexes for documents collection
    documents_collection = db["documents"]
    await documents_collection.create_index("project_id")
    await documents_collection.create_index([("project_id", 1), ("is_archived", 1)])
    await documents_collection.create_index("last_modified_by")
    await documents_collection.create_index("updated_at")
    print("Created indexes for documents collection")

    # Indexes for doc_comments collection
    doc_comments_collection = db["doc_comments"]
    await doc_comments_collection.create_index("document_id")
    await doc_comments_collection.create_index([("document_id", 1), ("status", 1)])
    await doc_comments_collection.create_index("created_by")
    await doc_comments_collection.create_index("mentioned_user_ids")
    print("Created indexes for doc_comments collection")

    # Indexes for whiteboard_snapshots collection
    whiteboard_collection = db["whiteboard_snapshots"]
    await whiteboard_collection.create_index("project_id")
    await whiteboard_collection.create_index(
        [("project_id", 1), ("snapshot_type", 1), ("snapshot_version", -1)]
    )
    print("Created indexes for whiteboard_snapshots collection")

    # Indexes for resources collection
    resources_collection = db["resources"]
    await resources_collection.create_index("project_id")
    await resources_collection.create_index("uploaded_by")
    await resources_collection.create_index("mime_type")
    await resources_collection.create_index([("project_id", 1), ("uploaded_at", -1)])
    print("Created indexes for resources collection")

    # Indexes for activity_logs collection
    activity_logs_collection = db["activity_logs"]
    await activity_logs_collection.create_index("project_id")
    await activity_logs_collection.create_index("user_id")
    await activity_logs_collection.create_index("timestamp")
    await activity_logs_collection.create_index(
        [("project_id", 1), ("user_id", 1), ("timestamp", -1)]
    )
    await activity_logs_collection.create_index(
        [("timestamp", 1)], expireAfterSeconds=31536000
    )  # TTL: 365 days
    print("Created indexes for activity_logs collection")

    # Indexes for courses collection
    courses_collection = db["courses"]
    await courses_collection.create_index("teacher_id")
    await courses_collection.create_index("invite_code", unique=True)
    await courses_collection.create_index("students")
    await courses_collection.create_index([("teacher_id", 1), ("semester", 1)])
    print("Created indexes for courses collection")

    # Indexes for analytics_daily_stats collection
    analytics_collection = db["analytics_daily_stats"]
    await analytics_collection.create_index("project_id")
    await analytics_collection.create_index("user_id")
    await analytics_collection.create_index("date")
    await analytics_collection.create_index(
        [("project_id", 1), ("date", -1)]
    )
    await analytics_collection.create_index(
        [("user_id", 1), ("date", -1)]
    )
    await analytics_collection.create_index(
        [("project_id", 1), ("user_id", 1), ("date", -1)], unique=True
    )
    print("Created indexes for analytics_daily_stats collection")

    # Analyze slow queries (example)
    print("\nAnalyzing query performance...")
    # Example: analyze a common query
    explain_result = await projects_collection.find(
        {"owner_id": "test_user_id", "is_archived": False}
    ).explain()
    print(f"Query execution stats: {explain_result.get('executionStats', {})}")

    client.close()
    print("\nIndex optimization completed!")


if __name__ == "__main__":
    asyncio.run(optimize_indexes())

