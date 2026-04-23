"""System log model."""

from datetime import datetime
from typing import Optional

from beanie import Document as BeanieDocument
from pydantic import Field
from pymongo import IndexModel


class SystemLog(BeanieDocument):
    """System log model."""

    log_type: str = Field(
        ..., pattern="^(performance|operation|error|security)$", index=True
    )  # performance/operation/error/security
    level: str = Field(..., pattern="^(info|warning|error|critical)$", index=True)
    module: str = Field(..., max_length=100)
    message: str = Field(..., max_length=2000)
    details: Optional[dict] = None
    user_id: Optional[str] = Field(None, index=True)
    ip_address: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow, index=True)

    class Settings:
        """Beanie settings."""

        name = "system_logs"
        indexes = [
            [("log_type", 1), ("timestamp", 1)],
            [("level", 1), ("timestamp", 1)],
            [("timestamp", 1)],
            IndexModel([("timestamp", 1)], expireAfterSeconds=2592000),
        ]

