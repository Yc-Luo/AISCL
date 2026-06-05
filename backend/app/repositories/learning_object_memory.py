"""Structured learning-object memory for one collaboration group."""

from datetime import datetime
from typing import Any, Dict, List, Optional

from beanie import Document
from pydantic import Field


class LearningObjectMemory(Document):
    """A sourced question, claim, evidence item, conflict, decision, or task."""

    course_id: Optional[str] = Field(default=None, index=True)
    project_id: str = Field(..., index=True)
    group_id: str = Field(..., index=True)
    stage_id: Optional[str] = Field(default=None, index=True)
    condition_type: str = Field(default="experimental", pattern="^(experimental|control|unknown)$", index=True)
    experiment_version_id: Optional[str] = Field(default=None, index=True)
    optimization_version_id: Optional[str] = Field(default=None, index=True)

    object_type: str = Field(
        ...,
        pattern="^(question|claim|evidence|counterargument|conflict|decision|revision|todo|emotion_motivation)$",
        index=True,
    )
    title: str = Field(default="")
    content: str = Field(default="")
    keywords: List[str] = Field(default_factory=list)
    source_refs: List[Dict[str, Any]] = Field(default_factory=list)
    source_types: List[str] = Field(default_factory=list)
    created_by_type: str = Field(default="system", pattern="^(student|teacher|ai_assistant|system)$")
    created_by_user_id: Optional[str] = Field(default=None, index=True)

    status: str = Field(
        default="proposed",
        pattern="^(proposed|active|adopted|verified|contested|rejected|stale|superseded)$",
        index=True,
    )
    verification_state: str = Field(
        default="needs_verification",
        pattern="^(needs_verification|student_supported|artifact_supported|teacher_verified|conflicting)$",
        index=True,
    )
    confidence_score: float = Field(default=0.35, ge=0, le=1)
    recency_score: float = Field(default=1.0, ge=0, le=1)
    source_quality_score: float = Field(default=0.3, ge=0, le=1)
    collaboration_score: float = Field(default=0.0, ge=0, le=1)

    last_confirmed_at: Optional[datetime] = Field(default=None, index=True)
    last_used_at: Optional[datetime] = Field(default=None, index=True)
    superseded_by: Optional[str] = Field(default=None, index=True)
    version: int = Field(default=1, ge=1)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow, index=True)

    class Settings:
        """Beanie settings."""

        name = "learning_object_memories"
        indexes = [
            [("project_id", 1), ("group_id", 1), ("stage_id", 1), ("status", 1)],
            [("project_id", 1), ("group_id", 1), ("object_type", 1), ("updated_at", -1)],
            [("condition_type", 1), ("experiment_version_id", 1), ("updated_at", -1)],
        ]
