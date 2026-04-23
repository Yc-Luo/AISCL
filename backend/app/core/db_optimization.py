"""Database query optimization utilities."""

from typing import List, Optional
from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import settings


class DBOptimization:
    """Database query optimization utilities."""

    @staticmethod
    async def optimize_query(collection_name: str, query: dict) -> dict:
        """Analyze and optimize a MongoDB query.

        Args:
            collection_name: Collection name
            query: Query dict

        Returns:
            Optimization suggestions
        """
        client = AsyncIOMotorClient(settings.MONGODB_URI)
        db = client[settings.MONGODB_DB_NAME]
        collection = db[collection_name]

        # Explain query
        explain_result = await collection.find(query).explain()

        execution_stats = explain_result.get("executionStats", {})
        execution_time = execution_stats.get("executionTimeMillis", 0)
        total_docs_examined = execution_stats.get("totalDocsExamined", 0)
        total_docs_returned = execution_stats.get("nReturned", 0)

        suggestions = []

        # Check if index is used
        if execution_stats.get("executionStages", {}).get("stage") == "COLLSCAN":
            suggestions.append("Query is using collection scan. Consider adding an index.")

        # Check efficiency
        if total_docs_examined > total_docs_returned * 10:
            suggestions.append(
                f"Query examined {total_docs_examined} documents but returned only {total_docs_returned}. "
                "Consider optimizing query or adding index."
            )

        # Check execution time
        if execution_time > 100:
            suggestions.append(
                f"Query took {execution_time}ms. Consider optimization."
            )

        client.close()

        return {
            "execution_time_ms": execution_time,
            "docs_examined": total_docs_examined,
            "docs_returned": total_docs_returned,
            "suggestions": suggestions,
        }

    @staticmethod
    async def paginate_query(
        collection,
        query: dict,
        skip: int = 0,
        limit: int = 100,
        sort: Optional[dict] = None,
    ):
        """Execute paginated query with optimization."""
        cursor = collection.find(query)
        if sort:
            cursor = cursor.sort(sort)
        cursor = cursor.skip(skip).limit(limit)
        return await cursor.to_list(length=limit)


db_optimization = DBOptimization()

