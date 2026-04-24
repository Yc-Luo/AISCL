"""Schemas for research-mode event logging and export."""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ResearchEventPayload(BaseModel):
    """Single research event payload."""

    project_id: str
    experiment_version_id: Optional[str] = None
    room_id: Optional[str] = None
    group_id: Optional[str] = None
    user_id: Optional[str] = None
    actor_type: str = Field(
        ...,
        pattern="^(student|teacher|ai_assistant|ai_tutor|system)$",
    )
    event_domain: str = Field(
        ...,
        pattern="^(dialogue|scaffold|inquiry_structure|shared_record|stage_transition|wiki|rag)$",
    )
    event_type: str = Field(..., pattern="^[a-zA-Z0-9_]+$")
    event_time: datetime
    stage_id: Optional[str] = None
    sequence_index: Optional[int] = Field(default=None, ge=0)
    payload: Dict[str, Any] = Field(default_factory=dict)


class ResearchEventBatchRequest(BaseModel):
    """Batch request for research events."""

    events: List[ResearchEventPayload] = Field(..., max_items=200)


class ResearchEventResponse(BaseModel):
    """Research event response schema."""

    id: str
    project_id: str
    experiment_version_id: Optional[str] = None
    room_id: Optional[str] = None
    group_id: Optional[str] = None
    user_id: Optional[str] = None
    actor_type: str
    event_domain: str
    event_type: str
    event_time: datetime
    stage_id: Optional[str] = None
    sequence_index: Optional[int] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class ResearchEventListResponse(BaseModel):
    """List response for research events."""

    events: List[ResearchEventResponse]
    total: int


class GroupStageFeatureRow(BaseModel):
    """Aggregated feature row for one group-stage unit."""

    project_id: str
    experiment_version_id: Optional[str] = None
    group_id: Optional[str] = None
    group_key: str
    stage_id: str
    event_count: int
    unique_actor_count: int
    active_span_seconds: Optional[float] = None
    node_add_count: int = 0
    edge_add_count: int = 0
    evidence_source_bind_count: int = 0
    evidence_source_open_count: int = 0
    shared_record_content_commit_count: int = 0
    shared_record_annotation_create_count: int = 0
    shared_record_annotation_reply_count: int = 0
    scaffold_rule_check_request_count: int = 0
    scaffold_rule_check_result_count: int = 0
    scaffold_rule_recommendation_accept_count: int = 0
    stage_transition_count: int = 0


class GroupStageFeatureListResponse(BaseModel):
    """List response for group-stage aggregated features."""

    features: List[GroupStageFeatureRow]
    total: int


class LSAReadyEventRow(BaseModel):
    """Behavior sequence row for LSA/HMM preparation."""

    project_id: str
    experiment_version_id: Optional[str] = None
    group_id: Optional[str] = None
    group_key: str
    stage_id: str
    sequence_index: int
    actor_type: str
    event_time: datetime
    event_domain: str
    event_type: str
    event_symbol: str


class LSAReadyEventListResponse(BaseModel):
    """List response for LSA-ready event sequences."""

    sequences: List[LSAReadyEventRow]
    total: int


class GroupChatTranscriptRow(BaseModel):
    """Full group-chat message row for transcript export."""

    id: str
    project_id: str
    group_id: str
    sequence_index: int
    user_id: str
    username: str
    user_role: Optional[str] = None
    actor_type: str
    message_type: str
    content: str
    content_length: int
    mentions: List[str] = Field(default_factory=list)
    mention_count: int = 0
    client_message_id: Optional[str] = None
    primary_agent: Optional[str] = None
    rationale_summary: Optional[str] = None
    routing_summary: List[str] = Field(default_factory=list)
    ai_meta: Optional[Dict[str, Any]] = None
    created_at: datetime


class GroupChatTranscriptListResponse(BaseModel):
    """List response for group-chat transcript export."""

    messages: List[GroupChatTranscriptRow]
    total: int


class AITutorTranscriptRow(BaseModel):
    """Full AI tutor message row for transcript export."""

    project_id: str
    conversation_id: str
    conversation_title: str
    conversation_user_id: str
    username: str
    user_role: Optional[str] = None
    persona_id: Optional[str] = None
    category: str
    message_id: str
    message_role: str
    turn_index: int
    content: str
    content_length: int
    citation_count: int = 0
    citations: List[Dict[str, Any]] = Field(default_factory=list)
    primary_view: Optional[str] = None
    rationale_summary: Optional[str] = None
    processing_summary: List[str] = Field(default_factory=list)
    ai_meta: Optional[Dict[str, Any]] = None
    message_created_at: datetime
    conversation_created_at: datetime
    conversation_updated_at: datetime


class AITutorTranscriptListResponse(BaseModel):
    """List response for AI tutor transcript export."""

    messages: List[AITutorTranscriptRow]
    total: int


class ResearchProjectHealthResponse(BaseModel):
    """Minimal health snapshot for one project's research data."""

    project_id: str
    experiment_version_count: int
    research_event_count: int
    stage_count: int
    has_scaffold_events: bool
    has_inquiry_events: bool
    has_shared_record_events: bool
    has_stage_events: bool
    has_rule_accept_events: bool
    last_event_time: Optional[datetime] = None
    event_domain_counts: Dict[str, int] = Field(default_factory=dict)
    key_event_counts: Dict[str, int] = Field(default_factory=dict)
