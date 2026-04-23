"""Schemas for project experiment-version configuration."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ExperimentVersionUpdateRequest(BaseModel):
    """Update request for project experiment version."""

    model_config = ConfigDict(populate_by_name=True)

    mode: str = Field(default="default", pattern="^(default|research)$")
    version_name: str = Field(
        default="default",
        min_length=1,
        max_length=50,
        alias="name",
    )
    stage_control_mode: str = Field(default="soft_guidance", pattern="^(soft_guidance|hard_constraint)$")
    process_scaffold_mode: str = Field(default="on", pattern="^(on|off)$")
    ai_scaffold_mode: str = Field(default="multi_agent", pattern="^(single_agent|multi_agent)$")
    broadcast_stage_updates: bool = True
    group_condition: Optional[str] = Field(default=None, max_length=50, alias="condition_group")
    enabled_scaffold_layers: List[str] = Field(default_factory=list)
    enabled_scaffold_roles: List[str] = Field(default_factory=list)
    enabled_rule_set: Optional[str] = Field(default=None, max_length=100)
    export_profile: Optional[str] = Field(default=None, max_length=100)
    stage_sequence: List[str] = Field(default_factory=list)
    current_stage: Optional[str] = Field(default=None, max_length=100)
    template_key: Optional[str] = Field(default=None, max_length=100)
    template_label: Optional[str] = Field(default=None, max_length=200)
    template_release_id: Optional[str] = Field(default=None, max_length=100)
    template_release_note: Optional[str] = Field(default=None, max_length=500)
    template_source: Optional[str] = Field(default=None, max_length=100)
    graph_version: Optional[str] = Field(default=None, max_length=100)
    source_course_id: Optional[str] = Field(default=None, max_length=100)
    template_bound_at: Optional[datetime] = None

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_keys(cls, data):
        """Accept legacy field names used in earlier docs or scripts."""
        if not isinstance(data, dict):
            return data
        normalized = dict(data)
        if "name" in normalized and "version_name" not in normalized:
            normalized["version_name"] = normalized["name"]
        if "condition_group" in normalized and "group_condition" not in normalized:
            normalized["group_condition"] = normalized["condition_group"]
        return normalized


class ExperimentVersionResponse(BaseModel):
    """Response schema for project experiment version."""

    project_id: str
    mode: str = Field(default="default", pattern="^(default|research)$")
    version_name: str = Field(default="default")
    stage_control_mode: str = Field(default="soft_guidance", pattern="^(soft_guidance|hard_constraint)$")
    process_scaffold_mode: str = Field(default="on", pattern="^(on|off)$")
    ai_scaffold_mode: str = Field(default="multi_agent", pattern="^(single_agent|multi_agent)$")
    broadcast_stage_updates: bool = True
    group_condition: Optional[str] = None
    enabled_scaffold_layers: List[str] = Field(default_factory=list)
    enabled_scaffold_roles: List[str] = Field(default_factory=list)
    enabled_rule_set: Optional[str] = None
    export_profile: Optional[str] = None
    stage_sequence: List[str] = Field(default_factory=list)
    current_stage: Optional[str] = None
    template_key: Optional[str] = None
    template_label: Optional[str] = None
    template_release_id: Optional[str] = None
    template_release_note: Optional[str] = None
    template_source: Optional[str] = None
    graph_version: Optional[str] = None
    source_course_id: Optional[str] = None
    template_bound_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
