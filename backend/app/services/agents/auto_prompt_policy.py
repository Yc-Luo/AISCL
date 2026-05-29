"""Automatic group prompt trigger policy."""

from __future__ import annotations

from typing import Any, Dict, Optional


AUTO_GROUP_PROMPT_RULE_TYPES = {
    "evidence_gap",
    "counterargument_missing",
    "revision_stall",
}

AUTO_PROMPT_STAGE_RULES = {
    "evidence_gap": {"meaning_exploration", "explanation_integration", "application_solution"},
    "counterargument_missing": {"explanation_integration", "application_solution"},
    "revision_stall": {"explanation_integration", "application_solution"},
}

AUTO_PROMPT_MIN_DIALOGUE_COUNT = {
    "evidence_gap": 8,
    "counterargument_missing": 9,
    "revision_stall": 10,
}

AUTO_PROMPT_MIN_ELAPSED_SECONDS = 600
AUTO_PROMPT_REVISION_MIN_ELAPSED_SECONDS = 900

RULE_TYPE_TO_SUBAGENT = {
    "evidence_gap": "evidence_researcher",
    "counterargument_missing": "viewpoint_challenger",
    "revision_stall": "feedback_prompter",
    "responsibility_risk": "problem_progressor",
}


def is_rule_eligible_for_live_group_prompt(
    *,
    rule_type: str,
    stage_id: Optional[str],
    intervention_context: Dict[str, Any],
) -> tuple[bool, Optional[str]]:
    """Gate live group prompts so early or off-stage discussion is not over-prompted."""
    allowed_stages = AUTO_PROMPT_STAGE_RULES.get(rule_type)
    if allowed_stages and stage_id not in allowed_stages:
        return False, "stage_not_eligible"

    dialogue_count = int(intervention_context.get("student_dialogue_count") or 0)
    min_dialogue_count = AUTO_PROMPT_MIN_DIALOGUE_COUNT.get(rule_type, 4)
    if dialogue_count < min_dialogue_count:
        return False, "insufficient_peer_dialogue"

    elapsed_seconds = int(intervention_context.get("session_elapsed_seconds") or 0)
    required_elapsed = (
        AUTO_PROMPT_REVISION_MIN_ELAPSED_SECONDS
        if rule_type == "revision_stall"
        else AUTO_PROMPT_MIN_ELAPSED_SECONDS
    )
    if elapsed_seconds < required_elapsed:
        return False, "discussion_too_short"

    return True, None
