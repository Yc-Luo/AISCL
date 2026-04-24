"""Initialize or update an AISCL administrator account.

Run inside the backend container:
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='ChangeMe123!' \
  python scripts/init_admin.py
"""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime

from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext


pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required")
    return value


def _validate_password(password: str) -> None:
    if len(password) < 8:
        raise ValueError("ADMIN_PASSWORD must be at least 8 characters long")


async def main() -> int:
    email = _required_env("ADMIN_EMAIL").lower()
    password = _required_env("ADMIN_PASSWORD")
    username = os.getenv("ADMIN_USERNAME", "admin").strip() or "admin"
    phone = os.getenv("ADMIN_PHONE", "").strip() or None
    mongodb_uri = os.getenv("MONGODB_URI", "mongodb://mongodb:27017/AISCL")
    mongodb_db_name = os.getenv("MONGODB_DB_NAME", "AISCL")

    if len(username) < 3:
        raise ValueError("ADMIN_USERNAME must be at least 3 characters long")
    _validate_password(password)

    client = AsyncIOMotorClient(mongodb_uri)
    try:
        db = client[mongodb_db_name]
        users = db["users"]
        now = datetime.utcnow()
        payload = {
            "username": username,
            "email": email,
            "password_hash": pwd_context.hash(password),
            "role": "admin",
            "phone": phone,
            "is_active": True,
            "is_banned": False,
            "settings": {},
            "updated_at": now,
        }

        existing = await users.find_one({"email": email})
        if existing:
            await users.update_one(
                {"_id": existing["_id"]},
                {"$set": payload},
            )
            print(f"Updated admin account: {email}")
        else:
            payload["created_at"] = now
            result = await users.insert_one(payload)
            print(f"Created admin account: {email} ({result.inserted_id})")

        await users.create_index("email")
        await users.create_index("username")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except Exception as exc:  # noqa: BLE001
        print(f"Admin initialization failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
