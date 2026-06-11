"""Remove TTL indexes from research data collections.

Derived export files may expire, but primary research traces must not be
deleted automatically. Run this migration once on existing deployments that
previously created 30-day/365-day TTL indexes.
"""

import asyncio
from typing import Iterable

from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import settings


PROTECTED_INDEXES = {
    "behavior_stream": [("timestamp", 1)],
    "heartbeat_stream": [("timestamp", 1)],
    "activity_logs": [("timestamp", 1)],
    "document_versions": [("created_at", 1)],
}


def _same_key(index_key: dict, expected: Iterable[tuple[str, int]]) -> bool:
    return list(index_key.items()) == list(expected)


async def remove_research_data_ttl_indexes() -> None:
    client = AsyncIOMotorClient(settings.MONGODB_URI)
    db = client[settings.MONGODB_DB_NAME]
    try:
        for collection_name, key in PROTECTED_INDEXES.items():
            collection = db[collection_name]
            async for index in collection.list_indexes():
                if index.get("expireAfterSeconds") is None:
                    continue
                if not _same_key(index.get("key", {}), key):
                    continue
                await collection.drop_index(index["name"])
                await collection.create_index(key)
                print(f"Recreated non-TTL index for {collection_name}: {key}")
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(remove_research_data_ttl_indexes())
