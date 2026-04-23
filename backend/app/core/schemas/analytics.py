"""Analytics schemas for API requests and responses."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class BehaviorDataRequest(BaseModel):
    """Request schema for single behavior data entry."""

    project_id: str
    user_id: str
    module: str = Field(..., pattern="^(whiteboard|document|chat|resource|resources|task|calendar|browser|ai|dashboard|analytics|inquiry)$")
    action: str = Field(..., pattern="^[a-zA-Z0-9_]+$")
    resource_id: Optional[str] = None
    metadata: Optional[dict] = None
    timestamp: Optional[datetime] = None


class BehaviorDataBatchRequest(BaseModel):
    """Request schema for batch behavior data."""

    behaviors: List[BehaviorDataRequest] = Field(..., max_items=100)


class HeartbeatRequest(BaseModel):
    """Request schema for heartbeat data."""

    project_id: str
    user_id: str
    module: str = Field(..., pattern="^(whiteboard|document|chat|resource|resources|task|calendar|browser|ai|dashboard|analytics|inquiry)$")
    resource_id: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class SuccessResponse(BaseModel):
    """Generic success response."""

    message: str

