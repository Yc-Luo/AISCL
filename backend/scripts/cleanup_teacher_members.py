"""Remove non-student accounts from project member lists.

Run inside the backend container:

  python scripts/cleanup_teacher_members.py --dry-run
  python scripts/cleanup_teacher_members.py --apply

The script keeps project.owner_id unchanged for teacher/admin management
permissions. It only cleans project.members, which represents learning-group
students.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from datetime import datetime
from typing import Any

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient


def _object_id(value: str | None) -> ObjectId | None:
    if value and ObjectId.is_valid(value):
        return ObjectId(value)
    return None


async def _load_user_roles(db, user_ids: set[str]) -> dict[str, str]:
    object_ids = [oid for oid in (_object_id(user_id) for user_id in user_ids) if oid]
    if not object_ids:
        return {}
    cursor = db["users"].find({"_id": {"$in": object_ids}}, {"role": 1, "username": 1, "email": 1})
    roles: dict[str, str] = {}
    async for user in cursor:
        roles[str(user["_id"])] = user.get("role") or "unknown"
    return roles


def _split_members(
    members: list[dict[str, Any]],
    user_roles: dict[str, str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    kept: list[dict[str, Any]] = []
    removed: list[dict[str, Any]] = []
    student_ids: list[str] = []

    for member in members:
        user_id = str(member.get("user_id") or "")
        role = user_roles.get(user_id)
        if role == "student":
            kept.append(member)
            student_ids.append(user_id)
            continue
        if role in {"teacher", "admin"}:
            removed.append({**member, "account_role": role})
            continue
        kept.append(member)

    return kept, removed, student_ids


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Only print affected projects.")
    mode.add_argument("--apply", action="store_true", help="Persist cleanup changes.")
    args = parser.parse_args()
    dry_run = not args.apply

    mongodb_uri = os.getenv("MONGODB_URI", "mongodb://mongodb:27017/AISCL")
    mongodb_db_name = os.getenv("MONGODB_DB_NAME", "AISCL")

    client = AsyncIOMotorClient(mongodb_uri)
    try:
        db = client[mongodb_db_name]
        projects = db["projects"]

        scanned = 0
        affected = 0
        removed_total = 0
        cursor = projects.find({}, {"name": 1, "owner_id": 1, "leader_id": 1, "members": 1})
        async for project in cursor:
            scanned += 1
            members = list(project.get("members") or [])
            if not members:
                continue

            user_ids = {str(member.get("user_id") or "") for member in members if member.get("user_id")}
            if project.get("owner_id"):
                user_ids.add(str(project.get("owner_id")))
            user_roles = await _load_user_roles(db, user_ids)
            kept_members, removed_members, student_ids = _split_members(members, user_roles)
            if not removed_members:
                continue

            affected += 1
            removed_total += len(removed_members)
            leader_id = project.get("leader_id")
            next_leader_id = leader_id if leader_id in student_ids else (student_ids[0] if student_ids else None)
            record = {
                "project_id": str(project["_id"]),
                "project_name": project.get("name"),
                "owner_id": project.get("owner_id"),
                "owner_role": user_roles.get(str(project.get("owner_id") or "")),
                "previous_leader_id": leader_id,
                "next_leader_id": next_leader_id,
                "removed_members": [
                    {
                        "user_id": member.get("user_id"),
                        "project_role": member.get("role"),
                        "account_role": member.get("account_role"),
                    }
                    for member in removed_members
                ],
            }
            print(json.dumps(record, ensure_ascii=False))

            if not dry_run:
                await projects.update_one(
                    {"_id": project["_id"]},
                    {
                        "$set": {
                            "members": kept_members,
                            "leader_id": next_leader_id,
                            "updated_at": datetime.utcnow(),
                        }
                    },
                )

        summary = {
            "mode": "dry-run" if dry_run else "apply",
            "scanned_projects": scanned,
            "affected_projects": affected,
            "removed_member_records": removed_total,
        }
        print(json.dumps(summary, ensure_ascii=False))
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
