"""Cache service for business logic caching."""

import logging
from typing import Dict, List, Optional, Any

from app.core.cache import get_cache, set_cache, delete_cache, delete_cache_pattern, CACHE_KEYS
from app.repositories.project import Project
from app.repositories.user import User

logger = logging.getLogger(__name__)


class CacheService:
    """Service for caching business logic data."""

    # Cache TTL values
    USER_TTL = 300  # 5 minutes
    PROJECT_TTL = 180  # 3 minutes
    PROJECT_MEMBERS_TTL = 120  # 2 minutes
    PERMISSIONS_TTL = 60  # 1 minute

    @classmethod
    async def get_cached_user(cls, user_id: str) -> Optional[User]:
        """Get user from cache or None if not cached."""
        cache_key = CACHE_KEYS["user"].format(user_id=user_id)
        return await get_cache(cache_key)

    @classmethod
    async def set_cached_user(cls, user: User) -> None:
        """Cache user data."""
        cache_key = CACHE_KEYS["user"].format(user_id=str(user.id))
        await set_cache(cache_key, user.dict(), cls.USER_TTL)

    @classmethod
    async def invalidate_user_cache(cls, user_id: str) -> None:
        """Invalidate user cache."""
        cache_key = CACHE_KEYS["user"].format(user_id=user_id)
        await delete_cache(cache_key)

    @classmethod
    async def get_cached_project(cls, project_id: str) -> Optional[Project]:
        """Get project from cache or None if not cached."""
        cache_key = CACHE_KEYS["project"].format(project_id=project_id)
        return await get_cache(cache_key)

    @classmethod
    async def set_cached_project(cls, project: Project) -> None:
        """Cache project data."""
        cache_key = CACHE_KEYS["project"].format(project_id=str(project.id))
        await set_cache(cache_key, project.dict(), cls.PROJECT_TTL)

    @classmethod
    async def invalidate_project_cache(cls, project_id: str) -> None:
        """Invalidate project cache and related caches."""
        # Invalidate project cache
        project_key = CACHE_KEYS["project"].format(project_id=project_id)
        await delete_cache(project_key)

        # Invalidate project members cache
        members_key = CACHE_KEYS["project_members"].format(project_id=project_id)
        await delete_cache(members_key)

        # Invalidate permission caches
        await delete_cache_pattern(f"perm:project:{project_id}:*")

    @classmethod
    async def get_cached_project_members(cls, project_id: str) -> Optional[List[Dict]]:
        """Get project members from cache."""
        cache_key = CACHE_KEYS["project_members"].format(project_id=project_id)
        return await get_cache(cache_key)

    @classmethod
    async def set_cached_project_members(cls, project_id: str, members: List[Dict]) -> None:
        """Cache project members."""
        cache_key = CACHE_KEYS["project_members"].format(project_id=project_id)
        await set_cache(cache_key, members, cls.PROJECT_MEMBERS_TTL)

    @classmethod
    async def get_cached_user_permissions(cls, user_id: str, project_id: str) -> Optional[str]:
        """Get cached user permissions for a project."""
        cache_key = f"perm:project:{project_id}:user:{user_id}"
        return await get_cache(cache_key)

    @classmethod
    async def set_cached_user_permissions(cls, user_id: str, project_id: str, role: str) -> None:
        """Cache user permissions for a project."""
        cache_key = f"perm:project:{project_id}:user:{user_id}"
        await set_cache(cache_key, role, cls.PERMISSIONS_TTL)

    @classmethod
    async def invalidate_user_permissions_cache(cls, user_id: str, project_id: str) -> None:
        """Invalidate user permissions cache."""
        cache_key = f"perm:project:{project_id}:user:{user_id}"
        await delete_cache(cache_key)

    @classmethod
    async def invalidate_all_permissions_cache(cls, project_id: str) -> None:
        """Invalidate all permissions cache for a project."""
        await delete_cache_pattern(f"perm:project:{project_id}:*")

    @classmethod
    async def clear_all_cache(cls) -> None:
        """Clear all application caches (use with caution)."""
        logger.warning("Clearing all application caches")
        await delete_cache_pattern("user:*")
        await delete_cache_pattern("project:*")
        await delete_cache_pattern("perm:*")

    @classmethod
    async def get_cache_stats(cls) -> Dict[str, Any]:
        """Get cache statistics (for monitoring)."""
        # This would need Redis INFO command or similar
        # For now, return a placeholder
        return {
            "cache_service": "CacheService",
            "status": "operational",
            "note": "Detailed stats need Redis INFO integration"
        }


# Global cache service instance
cache_service = CacheService()

