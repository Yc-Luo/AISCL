"""Redis cache layer with decorators and bloom filter support."""

import json
import hashlib
from functools import wraps
from typing import Any, Callable, Optional, TypeVar

import redis.asyncio as redis
from redis.asyncio import Redis

from app.core.config import settings

# Redis connection pool
_redis_client: Optional[Redis] = None

F = TypeVar("F", bound=Callable[..., Any])


async def get_redis_client() -> Redis:
    """Get or create Redis client."""
    global _redis_client
    if _redis_client is None:
        _redis_client = await redis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis_client


async def close_redis_client():
    """Close Redis client connection."""
    global _redis_client
    if _redis_client:
        await _redis_client.close()
        _redis_client = None


def cache_key(*args, **kwargs) -> str:
    """Generate cache key from function arguments."""
    key_parts = [str(arg) for arg in args]
    key_parts.extend([f"{k}:{v}" for k, v in sorted(kwargs.items())])
    key_string = ":".join(key_parts)
    return hashlib.md5(key_string.encode()).hexdigest()


def cached(
    ttl: int = 300,
    key_prefix: Optional[str] = None,
    exclude_args: Optional[list] = None,
):
    """Cache decorator for async functions.

    Args:
        ttl: Time to live in seconds (default: 5 minutes)
        key_prefix: Optional prefix for cache key
        exclude_args: List of argument names to exclude from cache key
    """

    def decorator(func: F) -> F:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Build cache key
            cache_key_parts = []
            if key_prefix:
                cache_key_parts.append(key_prefix)
            cache_key_parts.append(func.__name__)

            # Include args (excluding self/cls and excluded args)
            func_args = args[1:] if args and hasattr(args[0], func.__name__) else args
            if exclude_args:
                filtered_kwargs = {
                    k: v for k, v in kwargs.items() if k not in exclude_args
                }
            else:
                filtered_kwargs = kwargs

            cache_key_str = ":".join(
                cache_key_parts + [cache_key(*func_args, **filtered_kwargs)]
            )

            # Try to get from cache
            client = await get_redis_client()
            cached_value = await client.get(cache_key_str)

            if cached_value:
                return json.loads(cached_value)

            # Execute function
            result = await func(*args, **kwargs)

            # Store in cache
            await client.setex(
                cache_key_str, ttl, json.dumps(result, default=str)
            )

            return result

        return wrapper  # type: ignore

    return decorator


async def get_cache(key: str) -> Optional[Any]:
    """Get value from cache."""
    client = await get_redis_client()
    value = await client.get(key)
    if value:
        return json.loads(value)
    return None


async def set_cache(key: str, value: Any, ttl: int = 300) -> None:
    """Set value in cache."""
    client = await get_redis_client()
    await client.setex(key, ttl, json.dumps(value, default=str))


async def delete_cache(key: str) -> None:
    """Delete value from cache."""
    client = await get_redis_client()
    await client.delete(key)


async def delete_cache_pattern(pattern: str) -> None:
    """Delete all keys matching pattern."""
    client = await get_redis_client()
    keys = await client.keys(pattern)
    if keys:
        await client.delete(*keys)


class BloomFilter:
    """Simple Bloom filter implementation using Redis."""

    def __init__(self, name: str, capacity: int = 10000, error_rate: float = 0.01):
        """Initialize Bloom filter.

        Args:
            name: Filter name (Redis key prefix)
            capacity: Expected number of elements
            error_rate: Desired false positive rate
        """
        self.name = name
        self.capacity = capacity
        self.error_rate = error_rate
        # Calculate optimal number of hash functions and bits
        import math

        self.num_bits = int(
            -capacity * math.log(error_rate) / (math.log(2) ** 2)
        )
        self.num_hashes = int(self.num_bits * math.log(2) / capacity)

    async def add(self, item: str) -> None:
        """Add item to Bloom filter."""
        client = await get_redis_client()
        for i in range(self.num_hashes):
            hash_value = int(
                hashlib.md5(f"{item}:{i}".encode()).hexdigest(), 16
            )
            bit_index = hash_value % self.num_bits
            await client.setbit(f"{self.name}:bloom", bit_index, 1)

    async def contains(self, item: str) -> bool:
        """Check if item might be in Bloom filter."""
        client = await get_redis_client()
        for i in range(self.num_hashes):
            hash_value = int(
                hashlib.md5(f"{item}:{i}".encode()).hexdigest(), 16
            )
            bit_index = hash_value % self.num_bits
            if await client.getbit(f"{self.name}:bloom", bit_index) == 0:
                return False
        return True


# Common cache keys
CACHE_KEYS = {
    "user": "user:{user_id}",
    "project": "project:{project_id}",
    "project_members": "project:{project_id}:members",
    "course": "course:{course_id}",
    "document": "document:{doc_id}",
}

