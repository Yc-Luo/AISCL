"""AI-related schemas for API requests and responses."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class AITutorMetaResponse(BaseModel):
    """Lightweight tutor-side routing metadata for persisted history."""

    primary_view: Optional[str] = None
    rationale_summary: Optional[str] = None
    processing_summary: List[str] = Field(default_factory=list)


class AIChatRequest(BaseModel):
    """Request schema for AI chat."""

    project_id: str
    message: Optional[str] = Field(None, max_length=2000)
    role_id: Optional[str] = None
    conversation_id: Optional[str] = None
    use_rag: bool = Field(default=True, description="Use RAG for context retrieval")
    current_stage: Optional[str] = Field(default=None, max_length=100)
    enabled_rule_set: Optional[str] = Field(default=None, max_length=100)
    enabled_scaffold_roles: List[str] = Field(default_factory=list)
    preferred_subagent: Optional[str] = Field(default=None, max_length=100)


class AIChatResponse(BaseModel):
    """Response schema for AI chat."""

    conversation_id: str
    message: str
    citations: List[dict] = Field(default_factory=list)
    suggestions: List[str] = Field(default_factory=list)
    ai_meta: Optional[AITutorMetaResponse] = None


class AIConversationResponse(BaseModel):
    """Response schema for an AI conversation."""

    id: str
    project_id: str
    user_id: str
    role_id: str
    title: str
    created_at: datetime
    updated_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class AIConversationListResponse(BaseModel):
    """Response schema for AI conversation list."""

    conversations: List[AIConversationResponse]
    total: int


class AIRoleResponse(BaseModel):
    """Response schema for an AI role."""

    id: str
    name: str
    icon: Optional[str] = None
    description: Optional[str] = None
    temperature: float
    is_default: bool
    created_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class AIRoleListResponse(BaseModel):
    """Response schema for AI role list."""

    roles: List[AIRoleResponse]


class InterventionRuleCreateRequest(BaseModel):
    """Request schema for creating an intervention rule."""

    project_id: Optional[str] = None
    rule_type: str = Field(..., pattern="^(silence|emotion|keyword|custom|evidence_gap|counterargument_missing|revision_stall|responsibility_risk)$")
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=1000)
    priority: int = Field(default=0, ge=0)
    enabled: bool = Field(default=True)
    silence_threshold: Optional[int] = Field(None, ge=0)
    emotion_keywords: Optional[List[str]] = None
    trigger_keywords: Optional[List[str]] = None
    minimum_evidence_count: Optional[int] = Field(None, ge=0)
    minimum_counterargument_count: Optional[int] = Field(None, ge=0)
    revision_stall_threshold: Optional[int] = Field(None, ge=0)
    max_ai_assistance_ratio: Optional[float] = Field(None, ge=0.0, le=1.0)
    action_type: str = Field(..., pattern="^(message|suggestion|question|redirect)$")
    message_template: str = Field(..., min_length=1, max_length=1000)
    ai_role_id: Optional[str] = None


class InterventionRuleUpdateRequest(BaseModel):
    """Request schema for updating an intervention rule."""

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=1000)
    priority: Optional[int] = Field(None, ge=0)
    enabled: Optional[bool] = None
    silence_threshold: Optional[int] = Field(None, ge=0)
    emotion_keywords: Optional[List[str]] = None
    trigger_keywords: Optional[List[str]] = None
    minimum_evidence_count: Optional[int] = Field(None, ge=0)
    minimum_counterargument_count: Optional[int] = Field(None, ge=0)
    revision_stall_threshold: Optional[int] = Field(None, ge=0)
    max_ai_assistance_ratio: Optional[float] = Field(None, ge=0.0, le=1.0)
    action_type: Optional[str] = Field(None, pattern="^(message|suggestion|question|redirect)$")
    message_template: Optional[str] = Field(None, min_length=1, max_length=1000)
    ai_role_id: Optional[str] = None


class InterventionRuleResponse(BaseModel):
    """Response schema for an intervention rule."""

    id: str
    project_id: Optional[str]
    rule_type: str
    name: str
    description: Optional[str]
    priority: int
    enabled: bool
    silence_threshold: Optional[int]
    emotion_keywords: Optional[List[str]]
    trigger_keywords: Optional[List[str]]
    minimum_evidence_count: Optional[int]
    minimum_counterargument_count: Optional[int]
    revision_stall_threshold: Optional[int]
    max_ai_assistance_ratio: Optional[float]
    action_type: str
    message_template: str
    ai_role_id: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class AIMessageResponse(BaseModel):
    """Response schema for an AI message."""

    id: str
    conversation_id: str
    role: str
    content: str
    citations: List[dict] = Field(default_factory=list)
    ai_meta: Optional[AITutorMetaResponse] = None
    created_at: datetime

    class Config:
        """Pydantic config."""

        from_attributes = True


class AIMessageListResponse(BaseModel):
    """Response schema for AI message list."""

    messages: List[AIMessageResponse]
    total: int


class AIContextActionRequest(BaseModel):
    """Request schema for specialized context actions."""

    project_id: str
    action_type: str = Field(..., pattern="^(summarize|knowledge_graph|optimize|devil_advocate|inquiry_clustering)$")
    context_type: str = Field(..., pattern="^(document|whiteboard|browser|dashboard)$")
    content: str = Field(..., max_length=50000)
    additional_query: Optional[str] = Field(None, max_length=1000)


class InterventionCheckContext(BaseModel):
    """Request context for evaluating intervention rules."""

    last_message_time: Optional[datetime] = None
    recent_messages: List[dict] = Field(default_factory=list)
    user_activity: dict = Field(default_factory=dict)
    evidence_node_count: int = Field(default=0, ge=0)
    counter_argument_count: int = Field(default=0, ge=0)
    recent_revision_count: int = Field(default=0, ge=0)
    last_revision_time: Optional[datetime] = None
    session_elapsed_seconds: Optional[int] = Field(default=None, ge=0)
    ai_assistance_ratio: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class InterventionCheckRequest(BaseModel):
    """Request schema for checking applicable intervention rules."""

    project_id: str
    user_id: Optional[str] = None
    enabled_rule_set: Optional[str] = Field(default=None, max_length=200)
    context: InterventionCheckContext


class InterventionCheckResult(BaseModel):
    """Triggered intervention result."""

    rule_id: str
    rule_name: str
    rule_type: str
    rule_set_applied: Optional[str] = None
    action_type: str
    message: str
    ai_role_id: Optional[str]
    trigger_reason: str
