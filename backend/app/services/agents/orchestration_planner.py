"""Stage-aware orchestration planner for AISCL research agents."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional


SUBAGENT_LABELS = {
    "evidence_researcher": "资料研究员",
    "viewpoint_challenger": "观点挑战者",
    "feedback_prompter": "反馈追问者",
    "problem_progressor": "问题推进者",
}

ROLE_TO_SUBAGENT = {
    "cognitive_support": "evidence_researcher",
    "viewpoint_challenge": "viewpoint_challenger",
    "feedback_prompting": "feedback_prompter",
    "problem_progression": "problem_progressor",
}

KNOWLEDGE_CONSTRUCT_LABELS = {
    "problem_construction": "问题构建",
    "meaning_exploration": "意义探索",
    "explanation_integration": "解释整合",
    "application_solution": "应用解决",
}

REGULATION_CONSTRUCT_LABELS = {
    "goal_regulation": "目标调节",
    "process_monitoring": "过程监控",
    "strategy_coordination": "策略协同",
    "emotion_coordination": "情绪协调",
}

STAGE_ALIASES = {
    "task_import": "problem_construction",
    "任务导入": "problem_construction",
    "problem_planning": "problem_construction",
    "问题规划": "problem_construction",
    "problem_construction": "problem_construction",
    "问题构建": "problem_construction",
    "evidence_exploration": "meaning_exploration",
    "证据探究": "meaning_exploration",
    "meaning_exploration": "meaning_exploration",
    "意义探索": "meaning_exploration",
    "argumentation": "explanation_integration",
    "论证协商": "explanation_integration",
    "explanation_integration": "explanation_integration",
    "解释整合": "explanation_integration",
    "reflection_revision": "application_solution",
    "反思修订": "application_solution",
    "application_solution": "application_solution",
    "应用解决": "application_solution",
}


@dataclass(frozen=True)
class IntentPattern:
    intent: str
    keywords: List[str]
    support_need: str


class OrchestrationPlanner:
    """Decide orchestration mode and agents from research-aligned process states."""

    INTENT_PATTERNS = [
        IntentPattern("emotion_support", ["焦虑", "冲突", "争吵", "没人", "沉默", "情绪", "不愿意"], "emotion_or_participation_risk"),
        IntentPattern("clarify_task", ["做什么", "任务", "下一步", "怎么开始", "目标", "计划", "阶段"], "problem_framing"),
        IntentPattern("seek_evidence", ["证据", "资料", "来源", "数据", "文献", "案例", "依据", "背景", "概念", "什么是"], "evidence_gap"),
        IntentPattern("explore_perspectives", ["有哪些", "哪些角度", "不同角度", "不同观点", "多种可能", "多种观点", "其他观点", "还能怎么看"], "multiple_view_generation"),
        IntentPattern("challenge_view", ["反驳", "挑战", "不对", "另一种", "但是", "可是", "反例", "质疑", "局限", "漏洞"], "counterargument_missing"),
        IntentPattern("compare_views", ["比较", "区别", "优劣", "哪个好", "哪个对", "判断标准", "评价标准", "同伴意见", "ai输出"], "criteria_or_ai_peer_comparison"),
        IntentPattern("improve_argument", ["改进", "完善", "补充", "修订", "不足", "可辩护", "论证", "理由"], "reasoning_or_integration_need"),
        IntentPattern("seek_synthesis", ["综合", "总结", "归纳", "概括", "最终", "整合", "共识"], "reasoning_or_integration_need"),
        IntentPattern("apply_solve", ["解决", "方案", "应用", "结论", "落地", "提交", "成果", "实践", "适用条件", "边界", "风险"], "application_boundary_check"),
    ]

    STAGE_DEFAULTS = {
        "problem_construction": ("single", ["problem_progressor"]),
        "meaning_exploration": ("parallel", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter"]),
        "explanation_integration": ("debate", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter"]),
        "application_solution": ("pipeline", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter", "problem_progressor"]),
    }

    MATRIX = {
        ("problem_construction", "clarify_task"): ("single", ["problem_progressor"]),
        ("problem_construction", "seek_evidence"): ("single", ["evidence_researcher"]),
        ("problem_construction", "explore_perspectives"): ("parallel", ["problem_progressor", "evidence_researcher"]),
        ("meaning_exploration", "clarify_task"): ("single", ["problem_progressor"]),
        ("meaning_exploration", "seek_evidence"): ("single", ["evidence_researcher"]),
        ("meaning_exploration", "explore_perspectives"): ("parallel", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter"]),
        ("meaning_exploration", "challenge_view"): ("debate", ["evidence_researcher", "viewpoint_challenger"]),
        ("meaning_exploration", "compare_views"): ("parallel", ["viewpoint_challenger", "evidence_researcher", "feedback_prompter"]),
        ("explanation_integration", "seek_evidence"): ("single", ["evidence_researcher"]),
        ("explanation_integration", "challenge_view"): ("debate", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter"]),
        ("explanation_integration", "compare_views"): ("debate", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter"]),
        ("explanation_integration", "improve_argument"): ("debate", ["evidence_researcher", "feedback_prompter", "viewpoint_challenger"]),
        ("explanation_integration", "seek_synthesis"): ("pipeline", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter", "problem_progressor"]),
        ("application_solution", "seek_evidence"): ("single", ["evidence_researcher"]),
        ("application_solution", "challenge_view"): ("debate", ["evidence_researcher", "viewpoint_challenger"]),
        ("application_solution", "seek_synthesis"): ("pipeline", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter", "problem_progressor"]),
        ("application_solution", "apply_solve"): ("pipeline", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter", "problem_progressor"]),
    }

    RULE_TO_PLAN = {
        "evidence_gap": ("single", ["evidence_researcher"], "evidence_gap"),
        "counterargument_missing": ("debate", ["evidence_researcher", "viewpoint_challenger"], "counterargument_missing"),
        "revision_stall": ("single", ["feedback_prompter"], "reasoning_or_integration_need"),
        "responsibility_risk": ("single", ["problem_progressor"], "strategy_or_action_need"),
    }

    SUPPORT_TO_CONSTRUCTS = {
        "problem_framing": ("problem_construction", "goal_regulation"),
        "task_clarification": ("problem_construction", "goal_regulation"),
        "evidence_gap": ("meaning_exploration", "process_monitoring"),
        "criteria_or_ai_peer_comparison": ("meaning_exploration", "process_monitoring"),
        "multiple_view_generation": ("meaning_exploration", "strategy_coordination"),
        "counterargument_missing": ("explanation_integration", "process_monitoring"),
        "reasoning_or_integration_need": ("explanation_integration", "process_monitoring"),
        "application_boundary_check": ("application_solution", "process_monitoring"),
        "strategy_or_action_need": ("application_solution", "strategy_coordination"),
        "emotion_or_participation_risk": ("problem_construction", "emotion_coordination"),
    }

    @classmethod
    def normalize_stage(cls, stage: Optional[str]) -> str:
        raw = (stage or "").strip()
        if not raw:
            return "problem_construction"
        if raw in STAGE_ALIASES:
            return STAGE_ALIASES[raw]
        lowered = raw.lower()
        if lowered in STAGE_ALIASES:
            return STAGE_ALIASES[lowered]
        for marker, stage_id in STAGE_ALIASES.items():
            if marker and marker in raw:
                return stage_id
        return "problem_construction"

    @classmethod
    def detect_intent(cls, message: str) -> Dict[str, Any]:
        text = (message or "").lower()
        best: Optional[IntentPattern] = None
        best_score = 0
        for pattern in cls.INTENT_PATTERNS:
            score = sum(1 for keyword in pattern.keywords if keyword in text)
            if score > best_score:
                best = pattern
                best_score = score
        if not best:
            return {"intent": "general_chat", "support_need": "problem_framing", "score": 0}
        return {"intent": best.intent, "support_need": best.support_need, "score": best_score}

    @classmethod
    def resolve_enabled_subagents(
        cls,
        *,
        enabled_subagents: Optional[List[str]] = None,
        enabled_scaffold_roles: Optional[List[str]] = None,
    ) -> List[str]:
        valid = set(SUBAGENT_LABELS)
        resolved: List[str] = []
        for name in enabled_subagents or []:
            if name in valid and name not in resolved:
                resolved.append(name)
        if resolved:
            return resolved
        for role in enabled_scaffold_roles or []:
            mapped = ROLE_TO_SUBAGENT.get(role)
            if mapped and mapped not in resolved:
                resolved.append(mapped)
        return resolved or list(SUBAGENT_LABELS.keys())

    @classmethod
    def plan(
        cls,
        *,
        message: str,
        current_stage: Optional[str] = None,
        rule_type: Optional[str] = None,
        preferred_subagent: Optional[str] = None,
        enabled_subagents: Optional[List[str]] = None,
        enabled_scaffold_roles: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        stage = cls.normalize_stage(current_stage)
        available = cls.resolve_enabled_subagents(
            enabled_subagents=enabled_subagents,
            enabled_scaffold_roles=enabled_scaffold_roles,
        )
        decision_source = "stage_intent_matrix"
        intent_info = cls.detect_intent(message)
        support_need = intent_info["support_need"]

        if rule_type and rule_type in cls.RULE_TO_PLAN:
            mode, agents, support_need = cls.RULE_TO_PLAN[rule_type]
            decision_source = "rule_trigger"
        elif preferred_subagent and preferred_subagent in available:
            mode, agents = "single", [preferred_subagent]
            decision_source = "preferred_subagent"
        else:
            matrix_key = (stage, intent_info["intent"])
            mode, agents = cls.MATRIX.get(matrix_key, cls.STAGE_DEFAULTS.get(stage, cls.STAGE_DEFAULTS["problem_construction"]))

        agents = cls._restrict_agents(agents, available)
        if mode in {"parallel", "debate"} and len(agents) == 1:
            mode = "single"
        if mode == "pipeline" and len(agents) < 2:
            mode = "single"

        primary_agent = agents[0] if agents else available[0]
        knowledge_construct, regulation_construct = cls.SUPPORT_TO_CONSTRUCTS.get(
            support_need,
            (stage, "goal_regulation" if stage == "problem_construction" else "process_monitoring"),
        )
        instructions = cls._build_agent_instructions(
            mode=mode,
            agents=agents,
            support_need=support_need,
            knowledge_construct=knowledge_construct,
            regulation_construct=regulation_construct,
        )

        return {
            "orchestration_mode": mode,
            "active_agents": agents,
            "primary_subagent": primary_agent,
            "selected_subagent": primary_agent,
            "agent_instructions": instructions,
            "intent": intent_info["intent"],
            "intent_score": intent_info["score"],
            "decision_source": decision_source,
            "routing_source": decision_source,
            "current_stage": current_stage,
            "normalized_stage": stage,
            "knowledge_construct": knowledge_construct,
            "knowledge_construct_label": KNOWLEDGE_CONSTRUCT_LABELS[knowledge_construct],
            "regulation_construct": regulation_construct,
            "regulation_construct_label": REGULATION_CONSTRUCT_LABELS[regulation_construct],
            "support_need": support_need,
            "answer_policy": cls._answer_policy(support_need),
            "enabled_subagents": available,
            "preferred_subagent": preferred_subagent or None,
            "rule_type": rule_type or None,
            "constrained": decision_source in {"rule_trigger", "preferred_subagent"},
            "fallback_applied": False,
        }

    @classmethod
    def _restrict_agents(cls, agents: List[str], available: List[str]) -> List[str]:
        filtered = [agent for agent in agents if agent in available]
        return filtered or [available[0]]

    @classmethod
    def _answer_policy(cls, support_need: str) -> str:
        return {
            "problem_framing": "clarify_goal",
            "evidence_gap": "evidence_grounded",
            "criteria_or_ai_peer_comparison": "clarify_criteria_and_compare_views",
            "multiple_view_generation": "generate_and_compare_views",
            "counterargument_missing": "challenge_and_compare",
            "reasoning_or_integration_need": "socratic_revision",
            "application_boundary_check": "check_assumptions_and_boundaries",
            "strategy_or_action_need": "actionable_plan",
            "emotion_or_participation_risk": "coordinate_participation",
        }.get(support_need, "brief_actionable")

    @classmethod
    def _build_agent_instructions(
        cls,
        *,
        mode: str,
        agents: List[str],
        support_need: str,
        knowledge_construct: str,
        regulation_construct: str,
    ) -> Dict[str, str]:
        construct = KNOWLEDGE_CONSTRUCT_LABELS[knowledge_construct]
        regulation = REGULATION_CONSTRUCT_LABELS[regulation_construct]
        instructions: Dict[str, str] = {}
        for index, agent in enumerate(agents):
            label = SUBAGENT_LABELS.get(agent, agent)
            if mode == "pipeline":
                prefix = f"这是串联接力的第 {index + 1} 步。"
            elif mode == "debate":
                prefix = f"这是对话碰撞中的第 {index + 1} 个视角。"
            elif mode == "parallel":
                prefix = "请独立给出你的角色视角。"
            else:
                prefix = "请聚焦你的角色职责。"
            instructions[agent] = (
                f"{prefix}本轮协作知识建构为“{construct}”，共享调节为“{regulation}”，"
                f"支架需要为 {support_need}。请以“{label}”身份给出短而具体的支架回应。"
            )
        return instructions
