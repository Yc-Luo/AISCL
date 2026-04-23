"""Analytics daily statistics model."""

from datetime import datetime, date as DateType
from typing import Dict, Optional

from beanie import Document as BeanieDocument
from pydantic import Field


class AnalyticsDailyStats(BeanieDocument):
    """Daily aggregated statistics for analytics."""

    project_id: str = Field(..., index=True)
    user_id: str = Field(..., index=True)
    date: DateType = Field(..., index=True)
    active_minutes: int = Field(default=0, ge=0)  # Active time in minutes
    activity_score: float = Field(default=0.0, ge=0.0)  # Weighted activity score
    activity_breakdown: Dict[str, int] = Field(
        default_factory=dict
    )  # {action: count}
    # 4C Core Competencies
    communication_score: float = Field(default=0.0, ge=0.0, le=100.0)
    collaboration_score: float = Field(default=0.0, ge=0.0, le=100.0)
    critical_thinking_score: float = Field(default=0.0, ge=0.0, le=100.0)
    creativity_score: float = Field(default=0.0, ge=0.0, le=100.0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        """Beanie settings."""

        name = "analytics_daily_stats"
        indexes = []
        #     [("project_id", 1), ("date", 1)],
        #     [("user_id", 1), ("date", 1)],
        #     [("project_id", 1), ("user_id", 1), ("date", 1)],
        #     [("date", 1)],
        # ]

