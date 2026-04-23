"""Inquiry space snapshot model."""

from datetime import datetime
from beanie import Document
from pydantic import Field

class InquirySnapshot(Document):
    """Deep inquiry space snapshot document model."""

    project_id: str = Field(..., index=True)
    # 存储 Nodes 和 Edges 的 JSON 结构，或者 Y.js 更新向量
    data: bytes  # 保持与白板一致，使用 Y.js 更新向量
    snapshot_version: int = Field(default=1)
    snapshot_type: str = Field(default="inquiry")
    compressed: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""
        name = "inquiry_snapshots"
        indexes = [
            [("project_id", 1)],
            [("project_id", 1), ("snapshot_version", -1)],
            [("created_at", 1)],
        ]
