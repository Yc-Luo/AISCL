"""Stage-aware orchestration planner for AISCL research agents."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from app.services.agents.multi_agent_roles import ROLE_TO_SUBAGENT, SUBAGENT_LABELS
from app.services.agents.multi_agent_stage_matrix import (
    KNOWLEDGE_CONSTRUCT_LABELS,
    ORCHESTRATION_MATRIX,
    REGULATION_CONSTRUCT_LABELS,
    RULE_TO_PLAN as STAGE_RULE_TO_PLAN,
    STAGE_ALIASES,
    STAGE_DEFAULTS as STAGE_DEFAULT_PLAN,
    SUPPORT_TO_CONSTRUCTS as STAGE_SUPPORT_TO_CONSTRUCTS,
)


@dataclass(frozen=True)
class IntentPattern:
    intent: str
    keywords: List[str]
    support_need: str


class OrchestrationPlanner:
    """Decide orchestration mode and agents from research-aligned process states."""

    INTENT_PATTERNS = [
        IntentPattern(
            "deep_inquiry",
            [
                "深入追问",
                "深度追问",
                "深入探究",
                "深度探究",
                "深度节点",
                "探究节点",
                "论证节点",
                "核心问题",
                "证据需求",
                "争议点",
                "证据是否充分",
                "反例",
                "适用边界",
                "验证",
                "不要直接赞同",
                "四个方面",
                "放入论证空间",
                "放到论证空间",
                "整理成节点",
            ],
            "deep_inquiry_scaffold",
        ),
        IntentPattern("platform_help", ["怎么上传", "如何上传", "上传到", "上传资料", "怎么提交", "如何提交", "提交按钮", "上传成果", "按钮", "在哪里", "怎么用", "资源库", "wiki", "协作文档", "论证空间", "知识沉淀", "教师支持", "归档", "图片", "文件", "平台", "系统", "功能", "操作"], "platform_operation_help"),
        IntentPattern(
            "emotion_support",
            [
                "焦虑",
                "压力",
                "紧张",
                "害怕",
                "担心",
                "烦",
                "崩溃",
                "冲突",
                "争吵",
                "没人",
                "沉默",
                "情绪",
                "不愿意",
                "没动力",
                "不想做",
                "不想写",
                "做不下去",
                "太难",
                "不会",
                "放弃",
                "拖延",
                "没人参与",
                "不配合",
            ],
            "emotion_or_motivation_risk",
        ),
        IntentPattern("clarify_task", ["做什么", "任务", "下一步", "怎么开始", "目标", "计划", "阶段"], "problem_framing"),
        IntentPattern("seek_evidence", ["证据", "资料", "来源", "数据", "文献", "案例", "依据", "背景", "概念", "什么是"], "evidence_gap"),
        IntentPattern("explore_perspectives", ["有哪些", "哪些角度", "不同角度", "不同观点", "多种可能", "多种观点", "其他观点", "还能怎么看"], "multiple_view_generation"),
        IntentPattern("challenge_view", ["反驳", "挑战", "不对", "另一种", "但是", "可是", "反例", "质疑", "局限", "漏洞"], "counterargument_missing"),
        IntentPattern("compare_views", ["比较", "区别", "优劣", "哪个好", "哪个对", "判断标准", "评价标准", "同伴意见", "ai输出"], "criteria_or_ai_peer_comparison"),
        IntentPattern("improve_argument", ["改进", "完善", "补充", "修订", "不足", "可辩护", "论证", "理由"], "reasoning_or_integration_need"),
        IntentPattern("seek_synthesis", ["综合", "总结", "归纳", "概括", "最终", "整合", "共识"], "reasoning_or_integration_need"),
        IntentPattern("apply_solve", ["解决", "方案", "应用", "结论", "落地", "提交", "成果", "实践", "适用条件", "边界", "风险"], "application_boundary_check"),
    ]

    STAGE_DEFAULTS = STAGE_DEFAULT_PLAN
    MATRIX = ORCHESTRATION_MATRIX
    RULE_TO_PLAN = STAGE_RULE_TO_PLAN
    SUPPORT_TO_CONSTRUCTS = STAGE_SUPPORT_TO_CONSTRUCTS

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
            "deep_inquiry_scaffold": "structure_deep_inquiry_nodes",
            "application_boundary_check": "check_assumptions_and_boundaries",
            "strategy_or_action_need": "actionable_plan",
            "emotion_or_participation_risk": "coordinate_participation",
            "emotion_or_motivation_risk": "emotion_motivation_scaffold",
            "platform_operation_help": "platform_operation_guidance",
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
                f"支架需要为 {support_need}。请以“{label}”身份给出具体、有层次且贴合问题类型的支架回应，"
                "必须遵循“识别处境 -> 温和回应 -> 追问关键缺口 -> 下一步支架 -> 小组协作提醒”的回应顺序。"
                "如果检测到焦虑、沉默、没动力、冲突或觉得太难，先把压力降下来，把任务切成一个可在 10 分钟内完成的小动作，"
                "再回到证据、观点、修订或分工。不要机械重复同一种建议。"
            )
        return instructions
