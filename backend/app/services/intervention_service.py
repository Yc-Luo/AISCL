"""AI intervention service for automatic AI interventions."""

from datetime import datetime
from typing import List, Optional, Set

from app.repositories.ai_intervention_rule import AIInterventionRule
from app.services.ai_service import ai_service


class InterventionService:
    """Service for AI automatic interventions."""

    DEFAULT_RESEARCH_RULES = [
        {
            "rule_type": "evidence_gap",
            "name": "证据不足提示",
            "description": "当当前协作中缺少明确证据或证据来源时，提示补充证据与出处。",
            "priority": 90,
            "enabled": True,
            "minimum_evidence_count": 1,
            "action_type": "suggestion",
            "message_template": "请先补充能够支持当前观点的证据，并说明这些证据来自哪里、为什么可信。",
        },
        {
            "rule_type": "counterargument_missing",
            "name": "反驳缺失提示",
            "description": "当当前讨论没有出现反驳、质疑或替代观点时，提示引入不同立场。",
            "priority": 80,
            "enabled": True,
            "minimum_counterargument_count": 1,
            "action_type": "question",
            "message_template": "请尝试提出一个可能的反对意见或替代解释，并比较它与当前观点哪个更有依据。",
        },
        {
            "rule_type": "revision_stall",
            "name": "修订停滞提示",
            "description": "当讨论持续推进但迟迟没有修订或更新观点时，提示进行修订比较。",
            "priority": 70,
            "enabled": True,
            "revision_stall_threshold": 120,
            "action_type": "question",
            "message_template": "请回看前面的讨论，说明目前的观点是否需要修订；如果要修订，请指出修订的依据和变化点。",
        },
        {
            "rule_type": "responsibility_risk",
            "name": "判断责任提示",
            "description": "当 AI 辅助占比过高时，提示学习者回到自主判断与责任承担。",
            "priority": 60,
            "enabled": True,
            "max_ai_assistance_ratio": 0.6,
            "action_type": "message",
            "message_template": "请不要直接接受 AI 给出的结论。请说明你自己的判断是什么，以及你为何决定采纳或不采纳 AI 的建议。",
        },
    ]

    RULE_SET_PRESETS = {
        "research-default": {
            "evidence_gap",
            "counterargument_missing",
            "revision_stall",
            "responsibility_risk",
        },
        "evidence-focus": {"evidence_gap"},
        "argumentation-focus": {"evidence_gap", "counterargument_missing"},
        "revision-focus": {"revision_stall"},
        "responsibility-focus": {"responsibility_risk"},
        "process-focus": {
            "evidence_gap",
            "counterargument_missing",
            "revision_stall",
        },
        "all": {
            "silence",
            "emotion",
            "keyword",
            "custom",
            "evidence_gap",
            "counterargument_missing",
            "revision_stall",
            "responsibility_risk",
        },
    }
    VALID_RULE_TYPES = RULE_SET_PRESETS["all"]
    RULE_SET_PROMPT_FRAMING = {
        "research-default": "",
        "evidence-focus": "请优先围绕证据来源、证据充分性和出处核验来回应。",
        "argumentation-focus": "请优先围绕不同观点、反驳生成和论证比较来回应。",
        "revision-focus": "请优先围绕观点修订、修改理由和修订前后差异来回应。",
        "responsibility-focus": "请优先强调学习者的自主判断、审慎采纳和最终责任承担。",
        "process-focus": "请优先围绕协作过程推进、共同记录、阶段目标和共享调节来回应。",
    }
    RULE_SET_FLAGS = {
        "group-chat-live",
    }

    @classmethod
    def _split_rule_set_spec(cls, enabled_rule_set: Optional[str]) -> tuple[Optional[str], Set[str]]:
        """Split rule-set spec into base preset and optional flags.

        Example:
        - research-default -> ("research-default", set())
        - research-default+group-chat-live -> ("research-default", {"group-chat-live"})
        """
        if not enabled_rule_set:
            return None, set()

        normalized = enabled_rule_set.strip().lower()
        if not normalized:
            return None, set()

        parts = [part.strip() for part in normalized.split("+") if part.strip()]
        if not parts:
            return None, set()

        base_name = parts[0]
        flags = {part for part in parts[1:] if part in cls.RULE_SET_FLAGS}
        return base_name, flags

    @staticmethod
    def _seconds_since(timestamp: Optional[datetime]) -> Optional[float]:
        if not timestamp:
            return None
        return (datetime.utcnow() - timestamp).total_seconds()

    @classmethod
    async def ensure_default_rules(cls) -> None:
        """Ensure the built-in global educational intervention rules exist."""
        for rule in cls.DEFAULT_RESEARCH_RULES:
            exists = await AIInterventionRule.find_one(
                {
                    "project_id": None,
                    "rule_type": rule["rule_type"],
                    "name": rule["name"],
                }
            )
            if exists:
                continue

            await AIInterventionRule(**rule).insert()

    @classmethod
    def _resolve_enabled_rule_types(cls, enabled_rule_set: Optional[str]) -> Optional[Set[str]]:
        """Resolve enabled rule set into explicit rule type names."""
        base_name, _flags = cls._split_rule_set_spec(enabled_rule_set)
        if not base_name:
            return None

        if base_name in cls.RULE_SET_PRESETS:
            return set(cls.RULE_SET_PRESETS[base_name])

        explicit_types = {
            token.strip().lower()
            for token in base_name.split(",")
            if token.strip()
        }
        filtered_types = explicit_types & cls.VALID_RULE_TYPES
        return filtered_types or None

    @classmethod
    def _build_intervention_message(
        cls,
        *,
        message_template: str,
        enabled_rule_set: Optional[str],
        rule_type: str,
    ) -> str:
        """Build the final intervention prompt shown to users and AI roles."""
        base_name, _flags = cls._split_rule_set_spec(enabled_rule_set)
        if not base_name:
            return message_template

        framing = cls.RULE_SET_PROMPT_FRAMING.get(base_name, "")
        if not framing:
            return message_template

        rule_hint = {
            "evidence_gap": "本次重点问题是证据不足。",
            "counterargument_missing": "本次重点问题是缺少反驳或替代观点。",
            "revision_stall": "本次重点问题是修订推进停滞。",
            "responsibility_risk": "本次重点问题是对 AI 的依赖过强、判断责任弱化。",
        }.get(rule_type, "")

        parts = [part for part in [rule_hint, framing, message_template] if part]
        return "\n".join(parts)

    @classmethod
    def is_group_chat_live_enabled(cls, enabled_rule_set: Optional[str]) -> bool:
        """Whether auto group prompts should be sent live to group chat."""
        _base_name, flags = cls._split_rule_set_spec(enabled_rule_set)
        return "group-chat-live" in flags

    @staticmethod
    async def check_interventions(
        project_id: str,
        user_id: str,
        context: dict,
        enabled_rule_set: Optional[str] = None,
    ) -> List[dict]:
        """Check if any intervention rules should be triggered.

        Args:
            project_id: Project ID
            user_id: User ID
            context: Context dict with:
                - last_message_time: Timestamp of last message
                - recent_messages: List of recent messages
                - user_activity: User activity data

        Returns:
            List of intervention actions to take
        """
        await InterventionService.ensure_default_rules()

        # Get applicable rules (project-specific and global)
        rules = await AIInterventionRule.find(
            {
                "$or": [
                    {"project_id": project_id, "enabled": True},
                    {"project_id": None, "enabled": True},  # Global rules
                ]
            }
        ).sort("-priority").to_list()
        enabled_rule_types = InterventionService._resolve_enabled_rule_types(enabled_rule_set)
        if enabled_rule_types is not None:
            rules = [
                rule for rule in rules
                if rule.rule_type in enabled_rule_types
            ]

        interventions = []

        for rule in rules:
            should_trigger = False
            trigger_reason = ""

            # Check rule conditions
            if rule.rule_type == "silence":
                if rule.silence_threshold:
                    last_message_time = context.get("last_message_time")
                    if last_message_time:
                        silence_duration = InterventionService._seconds_since(last_message_time)
                        if silence_duration >= rule.silence_threshold:
                            should_trigger = True
                            trigger_reason = "silence_threshold"

            elif rule.rule_type == "emotion":
                if rule.emotion_keywords:
                    recent_messages = context.get("recent_messages", [])
                    for msg in recent_messages:
                        content = msg.get("content", "").lower()
                        if any(
                            keyword.lower() in content
                            for keyword in rule.emotion_keywords
                        ):
                            should_trigger = True
                            trigger_reason = "emotion_keyword"
                            break

            elif rule.rule_type == "keyword":
                if rule.trigger_keywords:
                    recent_messages = context.get("recent_messages", [])
                    for msg in recent_messages:
                        content = msg.get("content", "").lower()
                        if any(
                            keyword.lower() in content
                            for keyword in rule.trigger_keywords
                        ):
                            should_trigger = True
                            trigger_reason = "trigger_keyword"
                            break

            elif rule.rule_type == "evidence_gap":
                minimum_count = rule.minimum_evidence_count if rule.minimum_evidence_count is not None else 1
                evidence_count = int(context.get("evidence_node_count") or 0)
                if evidence_count < minimum_count:
                    should_trigger = True
                    trigger_reason = "evidence_gap"

            elif rule.rule_type == "counterargument_missing":
                minimum_count = (
                    rule.minimum_counterargument_count
                    if rule.minimum_counterargument_count is not None
                    else 1
                )
                counter_argument_count = int(context.get("counter_argument_count") or 0)
                if counter_argument_count < minimum_count:
                    should_trigger = True
                    trigger_reason = "counterargument_missing"

            elif rule.rule_type == "revision_stall":
                if rule.revision_stall_threshold:
                    last_revision_time = context.get("last_revision_time")
                    recent_revision_count = int(context.get("recent_revision_count") or 0)
                    session_elapsed_seconds = int(context.get("session_elapsed_seconds") or 0)
                    stall_seconds = InterventionService._seconds_since(last_revision_time)
                    if stall_seconds is not None:
                        if stall_seconds >= rule.revision_stall_threshold:
                            should_trigger = True
                            trigger_reason = "revision_stall_threshold"
                    elif recent_revision_count == 0 and session_elapsed_seconds >= rule.revision_stall_threshold:
                        should_trigger = True
                        trigger_reason = "revision_absent"

            elif rule.rule_type == "responsibility_risk":
                if rule.max_ai_assistance_ratio is not None:
                    ai_assistance_ratio = context.get("ai_assistance_ratio")
                    if ai_assistance_ratio is not None and float(ai_assistance_ratio) >= rule.max_ai_assistance_ratio:
                        should_trigger = True
                        trigger_reason = "ai_assistance_ratio"

            elif rule.rule_type == "custom":
                # TODO: Evaluate custom condition
                pass

            if should_trigger:
                # Generate intervention message
                intervention = {
                    "rule_id": str(rule.id),
                    "rule_name": rule.name,
                    "rule_type": rule.rule_type,
                    "rule_set_applied": enabled_rule_set.strip().lower() if enabled_rule_set else None,
                    "action_type": rule.action_type,
                    "message": InterventionService._build_intervention_message(
                        message_template=rule.message_template,
                        enabled_rule_set=enabled_rule_set,
                        rule_type=rule.rule_type,
                    ),
                    "ai_role_id": rule.ai_role_id,
                    "trigger_reason": trigger_reason or rule.rule_type,
                }
                interventions.append(intervention)

        return interventions

    @staticmethod
    async def execute_intervention(
        project_id: str,
        user_id: str,
        intervention: dict,
    ) -> dict:
        """Execute an intervention action.

        Args:
            project_id: Project ID
            user_id: User ID
            intervention: Intervention dict from check_interventions

        Returns:
            Intervention result
        """
        # Use AI to generate personalized message if needed
        if intervention.get("ai_role_id"):
            # Generate AI response
            response = await ai_service.chat(
                project_id=project_id,
                user_id="system",  # System-initiated
                message=intervention["message"],
                role_id=intervention["ai_role_id"],
            )

            return {
                "type": intervention["action_type"],
                "message": response["message"],
                "conversation_id": response["conversation_id"],
            }
        else:
            return {
                "type": intervention["action_type"],
                "message": intervention["message"],
            }


intervention_service = InterventionService()
