"""
Deep Agents Shim Implementation.
This module simulates the behavior of the 'deepagents' library (LangChain v1.2.0 feature)
by wrapping LangGraph functionalities. This allows the system to run the requested
architecture even if the cutting-edge PyPI package is not yet available in the environment.
"""

from typing import List, Dict, Any, Optional, Union, Callable
from langgraph.graph import StateGraph, END
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import JsonOutputParser
from langchain_openai import ChatOpenAI
from typing import TypedDict, Annotated
import operator
import json


def _match_subagent_name(subagents: List[Dict[str, Any]], keywords: List[str], default: str) -> str:
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


def _contains_any(text: str, keywords: List[str]) -> bool:
    return any(keyword in text for keyword in keywords)


def _diagnose_collaboration_state(
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

    if _contains_any(text, ["焦虑", "压力", "紧张", "害怕", "担心", "烦", "崩溃", "冲突", "争吵", "不愿意", "没人", "沉默", "参与", "分歧太大", "情绪", "没动力", "不想做", "做不下去", "太难", "不会", "放弃", "拖延", "不配合"]):
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

    if _contains_any(text, ["适用条件", "适用范围", "前提", "限制", "边界", "任务情境", "检验方案", "检验这个方案", "风险"]):
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

    if _contains_any(text, ["ai输出", "ai 的输出", "ai说法", "ai 的说法", "同伴意见", "同学意见", "比较ai", "比较 ai", "比较同伴", "判断标准", "评价标准", "标准是什么"]):
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

    if _contains_any(text, ["多种观点", "多个观点", "不同解释", "多种解释", "多种看法", "观点有哪些", "还能怎么看", "其他角度"]):
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

    if _contains_any(text, ["资料", "证据", "来源", "文献", "案例", "数据", "背景", "概念", "什么是", "搜集", "搜索", "依据"]):
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

    if _contains_any(text, ["反驳", "反例", "质疑", "不同观点", "不同意见", "另一种解释", "替代解释", "局限", "漏洞", "争议", "挑战"]):
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

    if _contains_any(text, ["整合", "总结", "归纳", "共识", "解释", "观点", "论证", "理由", "标准", "充分", "不足", "修改", "修订", "评价", "可辩护"]):
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

    if _contains_any(text, ["方案", "解决", "应用", "实践", "提交", "成果", "下一步", "怎么做", "分工", "推进", "安排", "计划"]):
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

    if _contains_any(text, ["核心问题", "讨论焦点", "收束", "分歧指向", "界定问题", "澄清问题", "任务导入", "问题规划", "任务", "规划", "导入", "问题"]):
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


def derive_routing_decision_from_context(
    *,
    subagents: List[Dict[str, Any]],
    context: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Derive a deterministic routing decision from explicit experiment context.

    This is used as a stable fallback for logging and constrained routing when the
    event stream does not expose the supervisor state cleanly.
    """
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

    evidence_agent_name = _match_subagent_name(
        subagents,
        ["资料", "证据", "知识", "research", "evidence"],
        subagents[0]["name"],
    )
    challenger_agent_name = _match_subagent_name(
        subagents,
        ["挑战", "反驳", "challeng", "counterargument"],
        evidence_agent_name,
    )
    feedback_agent_name = _match_subagent_name(
        subagents,
        ["追问", "反馈", "question", "feedback", "socratic"],
        evidence_agent_name,
    )
    progress_agent_name = _match_subagent_name(
        subagents,
        ["推进", "规划", "协作", "progress", "stage", "problem"],
        evidence_agent_name,
    )
    effective_enabled_subagents = _normalize_enabled_subagents(
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

    def _classify_intervention_mode(target_agent: str) -> str:
        if target_agent in {feedback_agent_name, progress_agent_name}:
            return "process_guidance"
        if target_agent in {evidence_agent_name, challenger_agent_name}:
            return "evidence_argument_support"
        return "general_support"

    constrained_target = planner_decision.get("selected_subagent") or _select_constrained_subagent(
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
        "intervention_mode": _classify_intervention_mode(constrained_target),
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


def _normalize_enabled_subagents(
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


def _infer_stage_constrained_subagent(
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


def _build_constrained_instruction(
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


def _select_constrained_subagent(
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

    stage_target = _infer_stage_constrained_subagent(
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


from app.services.agents.multi_agent_routing import (  # noqa: E402
    build_constrained_instruction as _build_constrained_instruction,
    derive_routing_decision_from_context,
    diagnose_collaboration_state as _diagnose_collaboration_state,
    match_subagent_name as _match_subagent_name,
    normalize_enabled_subagents as _normalize_enabled_subagents,
    select_constrained_subagent as _select_constrained_subagent,
)

# --- State Definition (Simulating Deep Agents Internal State) ---

class DeepAgentState(TypedDict):
    messages: Annotated[List[BaseMessage], operator.add]
    plan: List[str]
    context: Dict[str, Any]
    next_step: str
    scratchpad: str
    intervention_mode: str
    routing_decision: Dict[str, Any]

# --- Core Function: create_deep_agent ---

def create_deep_agent(
    model: ChatOpenAI,
    subagents: List[Dict[str, Any]],
    system_prompt: str
) -> Any:
    """
    Creates a hierarchical agent graph following the Deep Agents architecture.
    
    Args:
        model: The LLM to act as the Supervisor/Planner.
        subagents: List of dicts defining sub-agents (name, description, prompt).
        system_prompt: The high-level instruction for the Supervisor.
        
    Returns:
        A compiled LangGraph application.
    """
    
    # 1. Define Supervisor Node (The Planner)
    async def supervisor_node(state: DeepAgentState):
        messages = state.get("messages", [])
        plan = state.get("plan", [])
        
        # 1.1 Calculate RAG Strategy
        context_data = state.get("context", {})
        rag_citations = context_data.get("rag_citations", [])
        rag_context = context_data.get("rag_context", "")
        group_chat_context = context_data.get("group_chat_context", "")
        group_peer_context = context_data.get("group_peer_context", "")
        group_ai_context = context_data.get("group_ai_context", "")
        group_state_context = context_data.get("group_state_context", "")
        stage_memory_context = context_data.get("stage_memory_context", "")
        project_task_context = context_data.get("project_task_context", "")
        current_stage = context_data.get("current_stage", "")
        rule_type = context_data.get("rule_type", "")
        enabled_scaffold_roles = context_data.get("enabled_scaffold_roles", [])
        preferred_subagent = context_data.get("preferred_subagent", "")
        enabled_subagents = context_data.get("enabled_subagents", [])
        latest_message = messages[-1].content if messages else ""
        max_score = max([c.get("score", 0) for c in rag_citations]) if rag_citations else 0

        evidence_agent_name = _match_subagent_name(
            subagents,
            ["资料", "证据", "知识", "research", "evidence"],
            subagents[0]["name"],
        )
        challenger_agent_name = _match_subagent_name(
            subagents,
            ["挑战", "反驳", "challeng", "counterargument"],
            evidence_agent_name,
        )
        feedback_agent_name = _match_subagent_name(
            subagents,
            ["追问", "反馈", "question", "feedback", "socratic"],
            evidence_agent_name,
        )
        progress_agent_name = _match_subagent_name(
            subagents,
            ["推进", "规划", "协作", "progress", "stage", "problem"],
            evidence_agent_name,
        )
        effective_enabled_subagents = _normalize_enabled_subagents(
            subagents=subagents,
            enabled_subagents=enabled_subagents,
            enabled_scaffold_roles=enabled_scaffold_roles,
        )
        collaboration_diagnosis = _diagnose_collaboration_state(
            message=latest_message,
            current_stage=current_stage,
            rule_type=rule_type,
            evidence_agent_name=evidence_agent_name,
            challenger_agent_name=challenger_agent_name,
            feedback_agent_name=feedback_agent_name,
            progress_agent_name=progress_agent_name,
        )

        def _classify_intervention_mode(target_agent: str) -> str:
            if target_agent in {feedback_agent_name, progress_agent_name}:
                return "process_guidance"
            if target_agent in {evidence_agent_name, challenger_agent_name}:
                return "evidence_argument_support"
            return "general_support"

        def _build_routing_decision(
            *,
            selected_subagent: str,
            routing_source: str,
            constrained: bool,
            fallback_applied: bool = False,
        ) -> Dict[str, Any]:
            return {
                "selected_subagent": selected_subagent,
                "routing_source": routing_source,
                "constrained": constrained,
                "fallback_applied": fallback_applied,
                "intervention_mode": _classify_intervention_mode(selected_subagent),
                "preferred_subagent": preferred_subagent or None,
                "rule_type": rule_type or None,
                "current_stage": current_stage or None,
                "enabled_subagents": effective_enabled_subagents,
                "collaboration_diagnosis": collaboration_diagnosis,
                **collaboration_diagnosis,
            }

        constrained_target = _select_constrained_subagent(
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
        if constrained_target:
            routing_decision = _build_routing_decision(
                selected_subagent=constrained_target,
                routing_source=(
                    "preferred_subagent"
                    if preferred_subagent and constrained_target == preferred_subagent
                    else "rule_or_stage_constraint"
                ),
                constrained=True,
            )
            return {
                "next_step": constrained_target,
                "plan": plan,
                "scratchpad": _build_constrained_instruction(
                    target_agent=constrained_target,
                    current_stage=current_stage,
                    rule_type=rule_type,
                    preferred_subagent=preferred_subagent,
                    collaboration_diagnosis=collaboration_diagnosis,
                ),
                "intervention_mode": routing_decision["intervention_mode"],
                "routing_decision": routing_decision,
            }

        # Define Tiered Strategy Note
        if max_score >= 0.7:
            strategy_note = f"HIGH SIMILARITY: Relevant information found. Prioritize {evidence_agent_name} to provide source-grounded support."
        elif max_score >= 0.3:
            strategy_note = (
                f"MEDIUM SIMILARITY: Some related information exists. Prefer {evidence_agent_name} or "
                f"{feedback_agent_name} to connect available evidence with the learner's current judgment."
            )
        else:
            strategy_note = (
                f"LOW SIMILARITY: No strong document match. Prefer {feedback_agent_name} or "
                f"{challenger_agent_name} to guide inquiry without fabricating facts."
            )

        # Identify available sub-agents for the prompt
        agents_desc = "\n".join([f"- {sa['name']}: {sa['description']}" for sa in subagents])
        
        supervisor_prompt = f"""{system_prompt}

You are the Deep Agent Supervisor. 
RAG Analysis: {strategy_note}
Retrieved Context: {rag_context}
Project Task Brief: {project_task_context or "none"}
Group State Memory: {group_state_context or "none"}
Stage Rolling Memory: {stage_memory_context or "none"}
Group Peer Discussion Memory: {group_peer_context or group_chat_context or "none"}
Group AI Interaction Memory: {group_ai_context or "none"}
Current Stage: {current_stage or "unknown"}
Triggered Rule Type: {rule_type or "none"}
Enabled Scaffold Roles: {enabled_scaffold_roles or "not specified"}
Enabled Sub-Agents: {effective_enabled_subagents or "not specified"}
Preferred Sub-Agent: {preferred_subagent or "none"}
Collaboration Knowledge Construction: {collaboration_diagnosis.get("knowledge_construct_label")} ({collaboration_diagnosis.get("knowledge_construct")})
Shared Regulation Focus: {collaboration_diagnosis.get("regulation_construct_label")} ({collaboration_diagnosis.get("regulation_construct")})
Support Need: {collaboration_diagnosis.get("support_need")}
Answer Policy: {collaboration_diagnosis.get("answer_policy")}

Manage the conversation using the available Sub-Agents:
{agents_desc}

Current Plan: {plan}

Tiered Response Policy:
- If a rule type is provided, prioritize the sub-agent most aligned with that rule type.
- If current stage is provided, prefer the sub-agent that best fits the stage goal.
- If enabled sub-agents are provided, you must keep delegation within that set.
- If a preferred sub-agent is provided, treat it as the first routing candidate unless it clearly conflicts with the user request.
- Use the collaboration diagnosis as the main pedagogical rationale when no explicit preferred sub-agent or rule type is present.
- If High Similarity: Prefer {evidence_agent_name}. Mention you found specific info in project materials.
- If Medium Similarity: Prefer {evidence_agent_name} or {feedback_agent_name}.
- If Low Similarity: Do NOT make up facts. Prefer {feedback_agent_name} or {challenger_agent_name}.
- If the user mainly needs task clarification or next steps, prefer {progress_agent_name}.

Analyze the latest user message.
1. Update the Plan if necessary.
2. Delegate the next task to a Sub-Agent based on the RAG Analysis.
3. If the task is strictly planning or general chat, reply directly.

Response Format (JSON):
{{{{
    "next_step": "sub_agent_name" OR "FINISH",
    "updated_plan": ["step1", "step2"],
    "instruction": "Instructions for the sub-agent including how to use the provided Context"
}}}}
"""
        prompt = ChatPromptTemplate.from_messages([
            ("system", supervisor_prompt),
            MessagesPlaceholder(variable_name="messages")
        ])
        
        chain = prompt | model.bind(response_format={"type": "json_object"}) | JsonOutputParser()
        
        try:
            # Use limited context window interaction
            result = await chain.ainvoke({"messages": messages[-3:]})
            next_step = result.get("next_step", "FINISH")
            fallback_applied = False
            if effective_enabled_subagents and next_step not in effective_enabled_subagents and next_step != "FINISH":
                fallback_target = _select_constrained_subagent(
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
                next_step = fallback_target or effective_enabled_subagents[0]
                fallback_applied = True
            routing_decision = (
                _build_routing_decision(
                    selected_subagent=next_step,
                    routing_source="llm_supervisor",
                    constrained=False,
                    fallback_applied=fallback_applied,
                )
                if next_step != "FINISH"
                else {
                    "selected_subagent": "FINISH",
                    "routing_source": "llm_supervisor",
                    "constrained": False,
                    "fallback_applied": fallback_applied,
                    "intervention_mode": "no_intervention",
                    "preferred_subagent": preferred_subagent or None,
                    "rule_type": rule_type or None,
                    "current_stage": current_stage or None,
                    "enabled_subagents": effective_enabled_subagents,
                }
            )
            state_update = {
                "next_step": next_step,
                "plan": result.get("updated_plan", plan),
                "scratchpad": result.get("instruction", ""),
                "intervention_mode": routing_decision["intervention_mode"],
                "routing_decision": routing_decision,
            }
        except Exception as e:
            # Fallback
            print(f"!!! SUPERVISOR ERROR: {e}")
            state_update = {
                "next_step": "FINISH",
                "plan": plan,
                "intervention_mode": "error_fallback",
                "routing_decision": {
                    "selected_subagent": "FINISH",
                    "routing_source": "supervisor_error",
                    "constrained": False,
                    "fallback_applied": False,
                    "intervention_mode": "error_fallback",
                    "preferred_subagent": preferred_subagent or None,
                    "rule_type": rule_type or None,
                    "current_stage": current_stage or None,
                    "enabled_subagents": effective_enabled_subagents,
                },
            }
            
        return state_update

    # 2. Define Sub-Agent Nodes (The Executors)
    def sub_agent_node_factory(agent_def: Dict[str, Any]):
        name = agent_def["name"]
        prompt_text = agent_def["system_prompt"]
        
        async def _node(state: DeepAgentState):
            messages = state["messages"]
            instruction = state.get("scratchpad", "")
            
            # Context Quarantine: Sub-agents see limited history + specific instruction
            rag_context = state.get("context", {}).get("rag_context", "")
            group_chat_context = state.get("context", {}).get("group_chat_context", "")
            group_peer_context = state.get("context", {}).get("group_peer_context", "")
            group_ai_context = state.get("context", {}).get("group_ai_context", "")
            group_state_context = state.get("context", {}).get("group_state_context", "")
            stage_memory_context = state.get("context", {}).get("stage_memory_context", "")
            project_task_context = state.get("context", {}).get("project_task_context", "")
            diagnosis = state.get("routing_decision", {}).get("collaboration_diagnosis") or state.get("context", {}).get("collaboration_diagnosis") or {}
            
            full_prompt = f"""{prompt_text}
            
Supervisor Instruction: {instruction}

Process Diagnosis:
- 协作知识建构：{diagnosis.get("knowledge_construct_label") or "未识别"}
- 共享调节：{diagnosis.get("regulation_construct_label") or "未识别"}
- 支架需要：{diagnosis.get("support_need") or "未识别"}
- 回答策略：{diagnosis.get("answer_policy") or "brief_actionable"}

Response Protocol:
- 先用一句话指出当前需要处理的协作问题或思考重点。
- 正文参考清晰助理回复的形式：用中等长度段落自然分层，不要把每句话都拆成单独短段；原因、步骤或方案使用 1. 2. 3. 编号；检查结果、资料标准或注意事项可用项目符号。
- 可使用自然小节标签，例如“当前需要先处理的是：”“建议这样推进：”“需要核验的内容：”“可以继续讨论的问题：”。不必机械套用固定三段。
- 回答应围绕问题、标准、证据和解释边界提供判断支架。
- 根据问题复杂度自然展开，普通问题可在 400-900 字内完成，复杂整合、平台操作或多角色接力可到 1200-1800 字；不要为了变短省略关键依据、步骤或同伴协作建议。
- 如果学习者询问 AISCL 平台操作，应优先说明进入哪个页签、点击哪个入口、下一步如何记录或提交；涉及命令、配置或导出路径时使用 Markdown 代码块。
- 不要机械重复同一种建议；根据问题类型选择步骤说明、观点比较、证据核查或协作推进。
- 提到具体小组成员姓名时，姓名后要加“同学”，例如“张三同学的建议”；不要直接裸称姓名。
- 不替学习者完成最终答案，不暴露实验条件、路由规则或内部系统配置。

Relevant Context for your use (Cite if using):
{rag_context}

Project Task Brief:
{project_task_context or "none"}

Group State Memory:
{group_state_context or "none"}

Stage Rolling Memory for continuity:
{stage_memory_context or "none"}

Group Peer Discussion Memory for continuity:
{group_peer_context or group_chat_context or "none"}

Group AI Interaction Memory for continuity:
{group_ai_context or "none"}
"""
            msg_prompt = ChatPromptTemplate.from_messages([
                ("system", full_prompt),
                # Accessing only the last user message + potentially critical context
                ("human", "{input}") 
            ])
            
            chain = msg_prompt | model
            
            # Simple interaction: Instruction + Last User Msg
            last_human = messages[-1].content if messages else ""
            response = await chain.ainvoke({"input": last_human})
            
            return {"messages": [response]}
            
        return _node

    # 3. Build Graph
    workflow = StateGraph(DeepAgentState)
    
    workflow.add_node("supervisor", supervisor_node)
    
    # Map for routing
    routing_map = {"FINISH": END}
    
    for sa in subagents:
        node_func = sub_agent_node_factory(sa) # Valid synchronous call
        workflow.add_node(sa["name"], node_func)
        workflow.add_edge(sa["name"], END)
        routing_map[sa["name"]] = sa["name"]
    
    workflow.set_entry_point("supervisor")
    
    workflow.add_conditional_edges(
        "supervisor",
        lambda x: x["next_step"],
        routing_map
    )
    
    return workflow.compile()
