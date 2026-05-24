"""Deterministic routing helpers for multi-agent orchestration."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.services.agents.multi_agent_roles import ROLE_TO_SUBAGENT
from app.services.agents.multi_agent_stage_matrix import (
    KNOWLEDGE_CONSTRUCT_LABELS,
    REGULATION_CONSTRUCT_LABELS,
)
from app.services.agents.orchestration_planner import OrchestrationPlanner


def match_subagent_name(subagents: List[Dict[str, Any]], keywords: List[str], default: str) -> str:
    """Infer a target sub-agent name from descriptions to avoid hard-coded role names."""
    valid_names = {subagent.get("name", "") for subagent in subagents}
    keyword_text = " ".join(keywords).lower()
    canonical_matches = [
        (["资料", "证据", "research", "evidence"], "evidence_researcher"),
        (["挑战", "反驳", "challeng", "counterargument"], "viewpoint_challenger"),
        (["追问", "反馈", "socratic"], "feedback_prompter"),
        (["推进", "规划", "协作", "progress", "stage", "problem"], "problem_progressor"),
    ]
    for marker_keywords, canonical_name in canonical_matches:
        if canonical_name in valid_names and any(marker in keyword_text for marker in marker_keywords):
            return canonical_name

    lowered_keywords = [keyword.lower() for keyword in keywords]
    for subagent in subagents:
        combined = f"{subagent.get('name', '')} {subagent.get('description', '')}".lower()
        if any(keyword in combined for keyword in lowered_keywords):
            return subagent["name"]
    return default


def contains_any(text: str, keywords: List[str]) -> bool:
    return any(keyword in text for keyword in keywords)


def diagnose_collaboration_state(
    *,
    message: str,
    current_stage: str,
    rule_type: str,
    evidence_agent_name: str,
    challenger_agent_name: str,
    feedback_agent_name: str,
    progress_agent_name: str,
) -> Dict[str, Any]:
    """Map the latest request to research-aligned process constructs."""
    text = f"{message or ''} {current_stage or ''} {rule_type or ''}".lower()

    diagnosis = {
        "knowledge_construct": "problem_construction",
        "knowledge_construct_label": KNOWLEDGE_CONSTRUCT_LABELS["problem_construction"],
        "regulation_construct": "goal_regulation",
        "regulation_construct_label": REGULATION_CONSTRUCT_LABELS["goal_regulation"],
        "support_need": "task_clarification",
        "primary_subagent": progress_agent_name,
        "answer_policy": "brief_next_step",
    }

    if contains_any(text, ["焦虑", "压力", "紧张", "害怕", "担心", "烦", "崩溃", "冲突", "争吵", "不愿意", "没人", "沉默", "参与", "分歧太大", "情绪", "没动力", "不想做", "做不下去", "太难", "不会", "放弃", "拖延", "不配合"]):
        diagnosis.update({
            "knowledge_construct": "problem_construction",
            "knowledge_construct_label": KNOWLEDGE_CONSTRUCT_LABELS["problem_construction"],
            "regulation_construct": "emotion_motivation_coordination",
            "regulation_construct_label": REGULATION_CONSTRUCT_LABELS["emotion_motivation_coordination"],
            "support_need": "emotion_or_motivation_risk",
            "primary_subagent": progress_agent_name,
            "answer_policy": "emotion_motivation_scaffold",
        })
        return diagnosis

    if contains_any(text, ["适用条件", "适用范围", "前提", "限制", "边界", "任务情境", "检验方案", "检验这个方案", "风险"]):
        diagnosis.update({
            "knowledge_construct": "application_solution",
            "knowledge_construct_label": KNOWLEDGE_CONSTRUCT_LABELS["application_solution"],
            "regulation_construct": "process_monitoring",
            "regulation_construct_label": REGULATION_CONSTRUCT_LABELS["process_monitoring"],
            "support_need": "application_boundary_check",
            "primary_subagent": feedback_agent_name,
            "answer_policy": "check_assumptions_and_boundaries",
        })
        return diagnosis

    if contains_any(text, ["ai输出", "ai 的输出", "ai说法", "ai 的说法", "同伴意见", "同学意见", "比较ai", "比较 ai", "比较同伴", "判断标准", "评价标准", "标准是什么"]):
        diagnosis.update({
            "knowledge_construct": "meaning_exploration",
            "knowledge_construct_label": KNOWLEDGE_CONSTRUCT_LABELS["meaning_exploration"],
            "regulation_construct": "process_monitoring",
            "regulation_construct_label": REGULATION_CONSTRUCT_LABELS["process_monitoring"],
            "support_need": "criteria_or_ai_peer_comparison",
            "primary_subagent": feedback_agent_name,
            "answer_policy": "clarify_criteria_and_compare_views",
        })
        return diagnosis

    if contains_any(text, ["多种观点", "多个观点", "不同解释", "多种解释", "多种看法", "观点有哪些", "还能怎么看", "其他角度"]):
        diagnosis.update({
            "knowledge_construct": "meaning_exploration",
            "knowledge_construct_label": KNOWLEDGE_CONSTRUCT_LABELS["meaning_exploration"],
            "regulation_construct": "strategy_coordination",
            "regulation_construct_label": REGULATION_CONSTRUCT_LABELS["strategy_coordination"],
            "support_need": "multiple_view_generation",
            "primary_subagent": challenger_agent_name,
            "answer_policy": "generate_and_compare_views",
        })
        return diagnosis

    if contains_any(text, ["资料", "证据", "来源", "文献", "案例", "数据", "背景", "概念", "什么是", "搜集", "搜索", "依据"]):
        diagnosis.update({
            "knowledge_construct": "meaning_exploration",
            "knowledge_construct_label": KNOWLEDGE_CONSTRUCT_LABELS["meaning_exploration"],
            "regulation_construct": "process_monitoring",
            "regulation_construct_label": REGULATION_CONSTRUCT_LABELS["process_monitoring"],
            "support_need": "evidence_gap",
            "primary_subagent": evidence_agent_name,
            "answer_policy": "evidence_grounded",
        })
        return diagnosis

    if contains_any(text, ["反驳", "反例", "质疑", "不同观点", "不同意见", "另一种解释", "替代解释", "局限", "漏洞", "争议", "挑战"]):
        diagnosis.update({
            "knowledge_construct": "explanation_integration",
            "knowledge_construct_label": KNOWLEDGE_CONSTRUCT_LABELS["explanation_integration"],
            "regulation_construct": "process_monitoring",
            "regulation_construct_label": REGULATION_CONSTRUCT_LABELS["process_monitoring"],
            "support_need": "counterargument_missing",
            "primary_subagent": challenger_agent_name,
            "answer_policy": "challenge_and_compare",
        })
        return diagnosis

    if contains_any(text, ["整合", "总结", "归纳", "共识", "解释", "观点", "论证", "理由", "标准", "充分", "不足", "修改", "修订", "评价", "可辩护"]):
        diagnosis.update({
            "knowledge_construct": "explanation_integration",
            "knowledge_construct_label": KNOWLEDGE_CONSTRUCT_LABELS["explanation_integration"],
            "regulation_construct": "process_monitoring",
            "regulation_construct_label": REGULATION_CONSTRUCT_LABELS["process_monitoring"],
            "support_need": "reasoning_or_integration_need",
            "primary_subagent": feedback_agent_name,
            "answer_policy": "socratic_revision",
        })
        return diagnosis

    if contains_any(text, ["方案", "解决", "应用", "实践", "提交", "成果", "下一步", "怎么做", "分工", "推进", "安排", "计划"]):
        diagnosis.update({
            "knowledge_construct": "application_solution",
            "knowledge_construct_label": KNOWLEDGE_CONSTRUCT_LABELS["application_solution"],
            "regulation_construct": "strategy_coordination",
            "regulation_construct_label": REGULATION_CONSTRUCT_LABELS["strategy_coordination"],
            "support_need": "strategy_or_action_need",
            "primary_subagent": progress_agent_name,
            "answer_policy": "actionable_plan",
        })
        return diagnosis

    if contains_any(text, ["核心问题", "讨论焦点", "收束", "分歧指向", "界定问题", "澄清问题", "任务导入", "问题规划", "任务", "规划", "导入", "问题"]):
        diagnosis.update({
            "knowledge_construct": "problem_construction",
            "knowledge_construct_label": KNOWLEDGE_CONSTRUCT_LABELS["problem_construction"],
            "regulation_construct": "goal_regulation",
            "regulation_construct_label": REGULATION_CONSTRUCT_LABELS["goal_regulation"],
            "support_need": "problem_framing",
            "primary_subagent": progress_agent_name,
            "answer_policy": "clarify_goal",
        })

    return diagnosis


def normalize_enabled_subagents(
    subagents: List[Dict[str, Any]],
    enabled_subagents: List[str],
    enabled_scaffold_roles: List[str],
) -> List[str]:
    """Resolve the effective available sub-agent set from explicit names or role keys."""
    valid_names = {subagent["name"] for subagent in subagents}
    resolved: List[str] = []

    for name in enabled_subagents or []:
        if name in valid_names and name not in resolved:
            resolved.append(name)

    if resolved:
        return resolved

    for role in enabled_scaffold_roles or []:
        mapped = ROLE_TO_SUBAGENT.get(role)
        if mapped in valid_names and mapped not in resolved:
            resolved.append(mapped)

    return resolved


def infer_stage_constrained_subagent(
    current_stage: str,
    progress_agent_name: str,
    evidence_agent_name: str,
    challenger_agent_name: str,
    feedback_agent_name: str,
) -> str:
    """Map current learning stage to the most relevant support role."""
    stage = (current_stage or "").strip()
    if not stage:
        return ""
    if any(keyword in stage for keyword in ["problem_construction", "问题构建", "任务导入", "问题规划", "任务", "规划", "导入", "问题"]):
        return progress_agent_name
    if any(keyword in stage for keyword in ["meaning_exploration", "意义探索", "证据探究", "证据", "资料", "来源"]):
        return evidence_agent_name
    if any(keyword in stage for keyword in ["explanation_integration", "解释整合", "论证协商", "论证", "协商", "反驳", "比较"]):
        return challenger_agent_name
    if any(keyword in stage for keyword in ["application_solution", "应用解决", "反思修订", "修订", "反思", "评价标准", "修正"]):
        return feedback_agent_name
    return ""


def build_constrained_instruction(
    target_agent: str,
    current_stage: str,
    rule_type: str,
    preferred_subagent: str,
    collaboration_diagnosis: Optional[Dict[str, Any]] = None,
) -> str:
    """Provide a deterministic routing instruction when explicit constraints are applied."""
    reasons: List[str] = []
    if preferred_subagent and target_agent == preferred_subagent:
        reasons.append("用户当前消息已显式点名该角色")
    if rule_type:
        reasons.append(f"当前命中的教育性规则为 {rule_type}")
    if current_stage:
        reasons.append(f"当前学习阶段为 {current_stage}")
    reason_text = "；".join(reasons) if reasons else "当前需要优先结合任务阶段与提问意图"
    diagnosis = collaboration_diagnosis or {}
    construct_text = ""
    if diagnosis:
        construct_text = (
            f"本轮诊断为协作知识建构“{diagnosis.get('knowledge_construct_label')}”、"
            f"共享调节“{diagnosis.get('regulation_construct_label')}”，"
            f"支架需要为 {diagnosis.get('support_need')}。"
        )
    return (
        f"本轮采用显式约束路由，直接交由 {target_agent} 处理。"
        f"请围绕当前问题提供该角色职责内的支架介入。"
        f"路由依据：{reason_text}。{construct_text}"
        "不要改派其他角色，不要退回通用回答。"
    )


def select_constrained_subagent(
    *,
    preferred_subagent: str,
    rule_type: str,
    current_stage: str,
    collaboration_diagnosis: Optional[Dict[str, Any]],
    enabled_subagents: List[str],
    evidence_agent_name: str,
    challenger_agent_name: str,
    feedback_agent_name: str,
    progress_agent_name: str,
) -> str:
    """Select sub-agent using explicit research constraints before falling back to the LLM."""
    available = enabled_subagents or [
        evidence_agent_name,
        challenger_agent_name,
        feedback_agent_name,
        progress_agent_name,
    ]

    def _is_available(name: str) -> bool:
        return bool(name) and name in available

    if _is_available(preferred_subagent):
        return preferred_subagent

    rule_mapping = {
        "evidence_gap": evidence_agent_name,
        "counterargument_missing": challenger_agent_name,
        "revision_stall": feedback_agent_name,
        "responsibility_risk": progress_agent_name,
        "emotion": progress_agent_name,
        "silence": progress_agent_name,
    }
    rule_target = rule_mapping.get(rule_type or "")
    if _is_available(rule_target):
        return rule_target

    diagnosis_target = (collaboration_diagnosis or {}).get("primary_subagent", "")
    if _is_available(diagnosis_target):
        return diagnosis_target

    stage_target = infer_stage_constrained_subagent(
        current_stage=current_stage,
        progress_agent_name=progress_agent_name,
        evidence_agent_name=evidence_agent_name,
        challenger_agent_name=challenger_agent_name,
        feedback_agent_name=feedback_agent_name,
    )
    if _is_available(stage_target):
        return stage_target

    if len(available) == 1:
        return available[0]

    return ""


def classify_intervention_mode(
    *,
    target_agent: str,
    evidence_agent_name: str,
    challenger_agent_name: str,
    feedback_agent_name: str,
    progress_agent_name: str,
) -> str:
    if target_agent in {feedback_agent_name, progress_agent_name}:
        return "process_guidance"
    if target_agent in {evidence_agent_name, challenger_agent_name}:
        return "evidence_argument_support"
    return "general_support"


def derive_routing_decision_from_context(
    *,
    subagents: List[Dict[str, Any]],
    context: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Derive a deterministic routing decision from explicit experiment context."""
    context = context or {}
    current_stage = context.get("current_stage", "") or ""
    rule_type = context.get("rule_type", "") or ""
    current_message = context.get("current_message", "") or context.get("message", "") or ""
    preferred_subagent = context.get("preferred_subagent", "") or ""
    enabled_scaffold_roles = context.get("enabled_scaffold_roles", []) or []
    enabled_subagents = context.get("enabled_subagents", []) or []

    planner_decision = OrchestrationPlanner.plan(
        message=current_message,
        current_stage=current_stage,
        rule_type=rule_type or None,
        preferred_subagent=preferred_subagent or None,
        enabled_subagents=enabled_subagents,
        enabled_scaffold_roles=enabled_scaffold_roles,
    )

    evidence_agent_name = match_subagent_name(
        subagents,
        ["资料", "证据", "知识", "research", "evidence"],
        subagents[0]["name"],
    )
    challenger_agent_name = match_subagent_name(
        subagents,
        ["挑战", "反驳", "challeng", "counterargument"],
        evidence_agent_name,
    )
    feedback_agent_name = match_subagent_name(
        subagents,
        ["追问", "反馈", "question", "feedback", "socratic"],
        evidence_agent_name,
    )
    progress_agent_name = match_subagent_name(
        subagents,
        ["推进", "规划", "协作", "progress", "stage", "problem"],
        evidence_agent_name,
    )
    effective_enabled_subagents = normalize_enabled_subagents(
        subagents=subagents,
        enabled_subagents=enabled_subagents,
        enabled_scaffold_roles=enabled_scaffold_roles,
    )
    collaboration_diagnosis = {
        "knowledge_construct": planner_decision["knowledge_construct"],
        "knowledge_construct_label": planner_decision["knowledge_construct_label"],
        "regulation_construct": planner_decision["regulation_construct"],
        "regulation_construct_label": planner_decision["regulation_construct_label"],
        "support_need": planner_decision["support_need"],
        "primary_subagent": planner_decision["selected_subagent"],
        "answer_policy": planner_decision["answer_policy"],
    }

    constrained_target = planner_decision.get("selected_subagent") or select_constrained_subagent(
        preferred_subagent=preferred_subagent,
        rule_type=rule_type,
        current_stage=current_stage,
        collaboration_diagnosis=collaboration_diagnosis,
        enabled_subagents=effective_enabled_subagents,
        evidence_agent_name=evidence_agent_name,
        challenger_agent_name=challenger_agent_name,
        feedback_agent_name=feedback_agent_name,
        progress_agent_name=progress_agent_name,
    )
    if not constrained_target:
        return None

    return {
        "selected_subagent": constrained_target,
        "routing_source": planner_decision.get("routing_source") or "stage_intent_matrix",
        "constrained": True,
        "fallback_applied": False,
        "intervention_mode": classify_intervention_mode(
            target_agent=constrained_target,
            evidence_agent_name=evidence_agent_name,
            challenger_agent_name=challenger_agent_name,
            feedback_agent_name=feedback_agent_name,
            progress_agent_name=progress_agent_name,
        ),
        "preferred_subagent": preferred_subagent or None,
        "rule_type": rule_type or None,
        "current_stage": current_stage or None,
        "enabled_subagents": effective_enabled_subagents,
        "orchestration_mode": planner_decision.get("orchestration_mode"),
        "active_agents": planner_decision.get("active_agents"),
        "intent": planner_decision.get("intent"),
        "normalized_stage": planner_decision.get("normalized_stage"),
        "decision_source": planner_decision.get("decision_source"),
        "collaboration_diagnosis": collaboration_diagnosis,
        **collaboration_diagnosis,
    }
