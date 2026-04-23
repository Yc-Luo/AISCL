"""Refresh token model."""

from datetime import datetime, timedelta
from typing import Optional

from beanie import Document
from pydantic import Field
from pymongo import IndexModel

from app.core.config import settings


class RefreshToken(Document):
    """Refresh token document model."""

    user_id: str
    token_hash: str
    expires_at: datetime = Field(
        default_factory=lambda: datetime.utcnow()
        + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    )
    is_revoked: bool = False
    device_info: Optional[dict] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "refresh_tokens"
        indexes = [
            [("user_id", 1)],
            [("token_hash", 1)],
            IndexModel([("expires_at", 1)], expireAfterSeconds=0),
        ]

