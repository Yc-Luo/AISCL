"""Migration script to create MongoDB Time Series Collections."""

import asyncio
from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import settings


async def create_timeseries_collections():
    """Create Time Series Collections for behavior and heartbeat streams."""
    client = AsyncIOMotorClient(settings.MONGODB_URI)
    db = client[settings.MONGODB_DB_NAME]

    # Create behavior_stream Time Series Collection
    try:
        await db.create_collection(
            "behavior_stream",
            timeseries={
                "timeField": "timestamp",
                "metaField": "metadata",
                "granularity": "seconds",
            },
        )
        print("Created behavior_stream Time Series Collection")
    except Exception as e:
        if "already exists" in str(e).lower():
            print("behavior_stream collection already exists")
        else:
            print(f"Error creating behavior_stream: {e}")

    # Create heartbeat_stream Time Series Collection
    try:
        await db.create_collection(
            "heartbeat_stream",
            timeseries={
                "timeField": "timestamp",
                "metaField": "metadata",
                "granularity": "seconds",
            },
        )
        print("Created heartbeat_stream Time Series Collection")
    except Exception as e:
        if "already exists" in str(e).lower():
            print("heartbeat_stream collection already exists")
        else:
            print(f"Error creating heartbeat_stream: {e}")

    # Create indexes
    behavior_collection = db["behavior_stream"]
    heartbeat_collection = db["heartbeat_stream"]

    # Indexes for behavior_stream
    await behavior_collection.create_index([("metadata.project_id", 1), ("timestamp", -1)])
    await behavior_collection.create_index([("metadata.user_id", 1), ("timestamp", -1)])
    await behavior_collection.create_index(
        [("timestamp", 1)], expireAfterSeconds=31536000
    )  # TTL: 365 days

    # Indexes for heartbeat_stream
    await heartbeat_collection.create_index([("metadata.project_id", 1), ("timestamp", -1)])
    await heartbeat_collection.create_index([("metadata.user_id", 1), ("timestamp", -1)])
    await heartbeat_collection.create_index(
        [("timestamp", 1)], expireAfterSeconds=31536000
    )  # TTL: 365 days

    print("Created indexes for Time Series Collections")
    client.close()


if __name__ == "__main__":
    asyncio.run(create_timeseries_collections())

