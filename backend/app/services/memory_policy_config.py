"""Runtime policy config for experimental memory and scaffold optimization."""

from __future__ import annotations

from typing import Any, Optional

from app.repositories.system_config import SystemConfig


VALID_OPTIMIZATION_MODES = {"off", "shadow", "active", "review"}


def _resolve_experiment_optimization_version(experiment_version: Optional[dict]) -> Optional[str]:
    if not experiment_version:
        return None
    return (
        experiment_version.get("optimization_version_id")
        or experiment_version.get("optimizationVersionId")
        or experiment_version.get("collaboration_optimization_version")
    )


async def _get_config_value(key: str) -> Optional[str]:
    config = await SystemConfig.find_one(SystemConfig.key == key)
    if not config or config.value is None:
        return None
    value = str(config.value).strip()
    return value or None


async def _get_int_config(key: str, default: int, *, minimum: int, maximum: int) -> int:
    value = await _get_config_value(key)
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    if parsed < minimum or parsed > maximum:
        return default
    return parsed


async def get_memory_policy_config(experiment_version: Optional[dict] = None) -> dict[str, Any]:
    """Return bounded memory/optimization policy values with safe defaults."""
    mode = (await _get_config_value("collaboration_optimization_mode") or "active").lower()
    if mode not in VALID_OPTIMIZATION_MODES:
        mode = "active"

    version_id = await _get_config_value("collaboration_optimization_version")
    if not version_id:
        version_id = _resolve_experiment_optimization_version(experiment_version) or "opt-v1"

    return {
        "collaboration_optimization_mode": mode,
        "collaboration_optimization_version": version_id,
        "memory_stale_after_days": await _get_int_config("memory_stale_after_days", 14, minimum=1, maximum=90),
        "memory_prompt_object_limit": await _get_int_config("memory_prompt_object_limit", 8, minimum=1, maximum=20),
        "scaffold_followup_window_minutes": await _get_int_config(
            "scaffold_followup_window_minutes",
            30,
            minimum=5,
            maximum=120,
        ),
    }
