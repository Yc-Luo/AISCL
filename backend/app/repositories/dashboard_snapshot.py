"""Dashboard snapshot model for cached analytics results."""

from datetime import datetime
from typing import Dict, List, Any
from beanie import Document
from pydantic import Field

class DashboardSnapshot(Document):
    """Cached dashboard data for a project."""
    
    project_id: str = Field(..., index=True)
    knowledge_graph: Dict[str, Any] = Field(default_factory=dict)
    interaction_network: Dict[str, Any] = Field(default_factory=dict)
    learning_suggestions: List[Dict[str, Any]] = Field(default_factory=list)
    four_c: Dict[str, float] = Field(default_factory=dict)
    summary: Dict[str, Any] = Field(default_factory=dict)
    activity_trend: List[Dict[str, Any]] = Field(default_factory=list)
    
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "dashboard_snapshots"
        indexes = [
            [("project_id", 1)],
            [("updated_at", 1)]
        ]
