"""Web annotation model for browser annotations."""

from datetime import datetime
from typing import Optional

from beanie import Document as BeanieDocument
from pydantic import Field


class WebAnnotation(BeanieDocument):
    """Web annotation model for browser annotations."""

    project_id: str = Field(..., index=True)
    url_hash: str = Field(..., index=True)  # MD5 hash of URL
    target_url: str = Field(..., max_length=2000)
    selector: dict = Field(default_factory=dict)  # CSS selector or text position
    annotation_type: str = Field(
        ..., pattern="^(highlight|sticky_note)$"
    )  # highlight or sticky_note
    color: Optional[str] = Field(None, pattern="^#[0-9A-Fa-f]{6}$")  # Hex color
    content: Optional[str] = Field(None, max_length=1000)  # Note content
    author_id: str = Field(..., index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "web_annotations"
        indexes = [
            [("project_id", 1), ("url_hash", 1)],
            [("author_id", 1)],
            [("created_at", 1)],
        ]

