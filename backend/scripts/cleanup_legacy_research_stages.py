"""Clean legacy 5-stage research template references from system configs.

Run inside the backend container:

  python scripts/cleanup_legacy_research_stages.py --dry-run
  python scripts/cleanup_legacy_research_stages.py --apply

The script only updates system_configs values for research templates and
release history. It does not modify courses, projects, messages, resources, or
student data.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from copy import deepcopy
from datetime import datetime
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient


TEMPLATE_CONFIG_KEY = "research_experiment_templates"
RELEASE_HISTORY_KEY = "research_release_history"

CURRENT_STAGE_SEQUENCE = [
    "problem_construction",
    "meaning_exploration",
    "explanation_integration",
    "application_solution",
]

LEGACY_STAGE_ID_MAP = {
    "orientation": "problem_construction",
    "planning": "problem_construction",
    "inquiry": "meaning_exploration",
    "argumentation": "explanation_integration",
    "revision": "application_solution",
}


def normalize_stage_id(stage_id: Any) -> str | None:
    if stage_id is None:
        return None
    normalized = LEGACY_STAGE_ID_MAP.get(str(stage_id), str(stage_id))
    return normalized if normalized in CURRENT_STAGE_SEQUENCE else None


def normalize_stage_sequence(stage_sequence: Any) -> list[str]:
    normalized: list[str] = []
    source_sequence = stage_sequence if isinstance(stage_sequence, list) else []
    for stage_id in source_sequence:
        mapped_stage_id = normalize_stage_id(stage_id)
        if mapped_stage_id and mapped_stage_id not in normalized:
            normalized.append(mapped_stage_id)
    return normalized or list(CURRENT_STAGE_SEQUENCE)


def normalize_template(template: dict[str, Any]) -> dict[str, Any]:
    next_template = deepcopy(template)
    stage_sequence = next_template.get("stageSequence") or next_template.get("stage_sequence") or []
    normalized_sequence = normalize_stage_sequence(stage_sequence)

    if "stageSequence" in next_template or "stage_sequence" not in next_template:
        next_template["stageSequence"] = normalized_sequence
    if "stage_sequence" in next_template:
        next_template["stage_sequence"] = normalized_sequence

    for snapshot_key in ("resolvedExperimentVersion", "experimentVersion", "template_snapshot"):
        snapshot = next_template.get(snapshot_key)
        if isinstance(snapshot, dict):
            next_template[snapshot_key] = normalize_snapshot(snapshot, normalized_sequence)

    return next_template


def normalize_snapshot(snapshot: dict[str, Any], fallback_stage_sequence: list[str] | None = None) -> dict[str, Any]:
    next_snapshot = deepcopy(snapshot)
    stage_sequence = normalize_stage_sequence(next_snapshot.get("stage_sequence") or fallback_stage_sequence or [])
    current_stage = normalize_stage_id(next_snapshot.get("current_stage"))
    if current_stage not in stage_sequence:
        current_stage = stage_sequence[0] if stage_sequence else None

    next_snapshot["stage_sequence"] = stage_sequence
    next_snapshot["current_stage"] = current_stage
    return next_snapshot


def normalize_templates_config(value: Any) -> Any:
    if not isinstance(value, list):
        return value
    return [normalize_template(template) if isinstance(template, dict) else template for template in value]


def normalize_release_history_config(value: Any) -> Any:
    if not isinstance(value, list):
        return value

    next_history = []
    for release in value:
        if not isinstance(release, dict):
            next_history.append(release)
            continue
        next_release = deepcopy(release)
        templates = next_release.get("templates")
        if isinstance(templates, list):
            next_release["templates"] = [
                normalize_template(template) if isinstance(template, dict) else template
                for template in templates
            ]
        next_history.append(next_release)
    return next_history


def _loads_config_value(raw_value: Any) -> Any:
    if not isinstance(raw_value, str) or not raw_value.strip():
        return None
    return json.loads(raw_value)


def _dumps_config_value(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Only print changed config keys.")
    mode.add_argument("--apply", action="store_true", help="Persist cleanup changes.")
    args = parser.parse_args()
    dry_run = not args.apply

    mongodb_uri = os.getenv("MONGODB_URI", "mongodb://mongodb:27017/AISCL")
    mongodb_db_name = os.getenv("MONGODB_DB_NAME", "AISCL")

    client = AsyncIOMotorClient(mongodb_uri)
    try:
        db = client[mongodb_db_name]
        system_configs = db["system_configs"]
        changed_keys: list[str] = []
        normalizers = {
            TEMPLATE_CONFIG_KEY: normalize_templates_config,
            RELEASE_HISTORY_KEY: normalize_release_history_config,
        }

        for key, normalize_value in normalizers.items():
            config = await system_configs.find_one({"key": key})
            if not config:
                print(json.dumps({"key": key, "status": "missing"}, ensure_ascii=False))
                continue

            try:
                parsed_value = _loads_config_value(config.get("value"))
            except json.JSONDecodeError as exc:
                print(json.dumps({"key": key, "status": "invalid_json", "error": str(exc)}, ensure_ascii=False))
                continue

            next_value = normalize_value(parsed_value)
            previous_serialized = _dumps_config_value(parsed_value)
            next_serialized = _dumps_config_value(next_value)
            if previous_serialized == next_serialized:
                print(json.dumps({"key": key, "status": "unchanged"}, ensure_ascii=False))
                continue

            changed_keys.append(key)
            print(json.dumps({"key": key, "status": "changed", "mode": "dry-run" if dry_run else "apply"}, ensure_ascii=False))
            if not dry_run:
                await system_configs.update_one(
                    {"_id": config["_id"]},
                    {
                        "$set": {
                            "value": next_serialized,
                            "updated_by": "cleanup_legacy_research_stages.py",
                            "updated_at": datetime.utcnow(),
                        }
                    },
                )

        print(
            json.dumps(
                {
                    "mode": "dry-run" if dry_run else "apply",
                    "changed_config_keys": changed_keys,
                    "changed_count": len(changed_keys),
                },
                ensure_ascii=False,
            )
        )
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
