"""Runtime controls for LLM concurrency and provider key rotation."""

from __future__ import annotations

import asyncio
import hashlib
import time
from collections import defaultdict
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, List, Optional, TypeVar

from app.core.config import settings


T = TypeVar("T")

_global_semaphore: Optional[asyncio.Semaphore] = None
_group_locks: Dict[str, asyncio.Lock] = {}
_key_cursor: Dict[str, int] = defaultdict(int)
_key_cooldowns: Dict[str, float] = {}


def _max_concurrency() -> int:
    return max(1, int(getattr(settings, "LLM_MAX_CONCURRENT_REQUESTS", 8) or 8))


def _get_global_semaphore() -> asyncio.Semaphore:
    global _global_semaphore
    if _global_semaphore is None:
        _global_semaphore = asyncio.Semaphore(_max_concurrency())
    return _global_semaphore


def _fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def _split_keys(value: Optional[str]) -> List[str]:
    if not value:
        return []
    if isinstance(value, str):
        return [item.strip() for item in value.replace("\n", ",").split(",") if item.strip()]
    return []


def select_api_key(provider: str, primary_key: Optional[str], pool_value: Optional[str] = None) -> Optional[str]:
    """Select an API key with simple round-robin and cooldown skipping."""
    candidates: List[str] = []
    for key in [*(_split_keys(pool_value)), primary_key or ""]:
        if key and key not in candidates:
            candidates.append(key)
    if not candidates:
        return primary_key

    now = time.monotonic()
    provider_key = (provider or "default").lower()
    start = _key_cursor[provider_key] % len(candidates)
    chosen = candidates[start]

    for offset in range(len(candidates)):
        index = (start + offset) % len(candidates)
        candidate = candidates[index]
        cooldown_until = _key_cooldowns.get(f"{provider_key}:{_fingerprint(candidate)}", 0)
        if cooldown_until <= now:
            chosen = candidate
            _key_cursor[provider_key] = index + 1
            break
    else:
        _key_cursor[provider_key] = start + 1

    return chosen


def mark_llm_failure(llm: Any, exc: Exception) -> None:
    """Temporarily cool down the key used by an LLM after rate-limit/server errors."""
    provider = getattr(llm, "_aiscl_provider", None)
    key_fingerprint = getattr(llm, "_aiscl_key_fingerprint", None)
    if not provider or not key_fingerprint:
        return
    message = str(exc).lower()
    if not any(token in message for token in ("429", "rate", "limit", "quota", "timeout", "5xx", "500", "502", "503", "504")):
        return
    cooldown = max(1, int(getattr(settings, "LLM_KEY_COOLDOWN_SECONDS", 60) or 60))
    _key_cooldowns[f"{provider}:{key_fingerprint}"] = time.monotonic() + cooldown


def attach_llm_metadata(llm: Any, *, provider: str, api_key: Optional[str], model: Optional[str]) -> Any:
    """Attach non-secret runtime metadata to provider instances."""
    try:
        object.__setattr__(llm, "_aiscl_provider", (provider or "default").lower())
        object.__setattr__(llm, "_aiscl_model", model or "")
        object.__setattr__(llm, "_aiscl_key_fingerprint", _fingerprint(api_key) if api_key else "")
    except Exception:
        pass
    return llm


async def guarded_ainvoke(llm: Any, payload: Any) -> Any:
    """Run one non-streaming LLM call under the global concurrency guard."""
    async with _get_global_semaphore():
        try:
            return await llm.ainvoke(payload)
        except Exception as exc:
            mark_llm_failure(llm, exc)
            raise


async def guarded_astream(llm: Any, payload: Any) -> AsyncIterator[Any]:
    """Run one streaming LLM call under the global concurrency guard."""
    async with _get_global_semaphore():
        try:
            async for chunk in llm.astream(payload):
                yield chunk
        except Exception as exc:
            mark_llm_failure(llm, exc)
            raise


async def guarded_call(factory: Callable[[], Awaitable[T]]) -> T:
    """Run an arbitrary LLM-backed operation under the global concurrency guard."""
    async with _get_global_semaphore():
        return await factory()


def get_group_lock(group_id: Optional[str]) -> Optional[asyncio.Lock]:
    """Return a per-group lock for public group AI turns."""
    if not group_id:
        return None
    key = str(group_id)
    lock = _group_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _group_locks[key] = lock
    return lock
