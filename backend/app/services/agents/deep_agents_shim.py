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
    lowered_keywords = [keyword.lower() for keyword in keywords]
    for subagent in subagents:
        combined = f"{subagent.get('name', '')} {subagent.get('description', '')}".lower()
        if any(keyword in combined for keyword in lowered_keywords):
            return subagent["name"]
    return default


ROLE_TO_SUBAGENT = {
    "cognitive_support": "evidence_researcher",
    "viewpoint_challenge": "viewpoint_challenger",
    "feedback_prompting": "feedback_prompter",
    "problem_progression": "problem_progressor",
}


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
    preferred_subagent = context.get("preferred_subagent", "") or ""
    enabled_scaffold_roles = context.get("enabled_scaffold_roles", []) or []
    enabled_subagents = context.get("enabled_subagents", []) or []

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

    def _classify_intervention_mode(target_agent: str) -> str:
        if target_agent in {feedback_agent_name, progress_agent_name}:
            return "process_guidance"
        if target_agent in {evidence_agent_name, challenger_agent_name}:
            return "evidence_argument_support"
        return "general_support"

    constrained_target = _select_constrained_subagent(
        preferred_subagent=preferred_subagent,
        rule_type=rule_type,
        current_stage=current_stage,
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
        "routing_source": (
            "preferred_subagent"
            if preferred_subagent and constrained_target == preferred_subagent
            else "rule_or_stage_constraint"
        ),
        "constrained": True,
        "fallback_applied": False,
        "intervention_mode": _classify_intervention_mode(constrained_target),
        "preferred_subagent": preferred_subagent or None,
        "rule_type": rule_type or None,
        "current_stage": current_stage or None,
        "enabled_subagents": effective_enabled_subagents,
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
    if any(keyword in stage for keyword in ["任务导入", "问题规划", "任务", "规划", "导入", "问题"]):
        return progress_agent_name
    if any(keyword in stage for keyword in ["证据探究", "证据", "资料", "来源"]):
        return evidence_agent_name
    if any(keyword in stage for keyword in ["论证协商", "论证", "协商", "反驳", "比较"]):
        return challenger_agent_name
    if any(keyword in stage for keyword in ["反思修订", "修订", "反思", "评价标准", "修正"]):
        return feedback_agent_name
    return ""


def _build_constrained_instruction(
    target_agent: str,
    current_stage: str,
    rule_type: str,
    preferred_subagent: str,
) -> str:
    """Provide a deterministic routing instruction when explicit constraints are applied."""
    reasons: List[str] = []
    if preferred_subagent and target_agent == preferred_subagent:
        reasons.append("用户当前消息已显式点名该角色")
    if rule_type:
        reasons.append(f"当前命中的教育性规则为 {rule_type}")
    if current_stage:
        reasons.append(f"当前学习阶段为 {current_stage}")
    reason_text = "；".join(reasons) if reasons else "当前需要优先满足实验配置与阶段要求"
    return (
        f"本轮采用显式约束路由，直接交由 {target_agent} 处理。"
        f"请围绕当前问题提供该角色职责内的支架介入。"
        f"路由依据：{reason_text}。"
        "不要改派其他角色，不要退回通用回答。"
    )


def _select_constrained_subagent(
    *,
    preferred_subagent: str,
    rule_type: str,
    current_stage: str,
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
    }
    rule_target = rule_mapping.get(rule_type or "")
    if _is_available(rule_target):
        return rule_target

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
        current_stage = context_data.get("current_stage", "")
        rule_type = context_data.get("rule_type", "")
        enabled_scaffold_roles = context_data.get("enabled_scaffold_roles", [])
        preferred_subagent = context_data.get("preferred_subagent", "")
        enabled_subagents = context_data.get("enabled_subagents", [])
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
            }

        constrained_target = _select_constrained_subagent(
            preferred_subagent=preferred_subagent,
            rule_type=rule_type,
            current_stage=current_stage,
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
Current Stage: {current_stage or "unknown"}
Triggered Rule Type: {rule_type or "none"}
Enabled Scaffold Roles: {enabled_scaffold_roles or "not specified"}
Enabled Sub-Agents: {effective_enabled_subagents or "not specified"}
Preferred Sub-Agent: {preferred_subagent or "none"}

Manage the conversation using the available Sub-Agents:
{agents_desc}

Current Plan: {plan}

Tiered Response Policy:
- If a rule type is provided, prioritize the sub-agent most aligned with that rule type.
- If current stage is provided, prefer the sub-agent that best fits the stage goal.
- If enabled sub-agents are provided, you must keep delegation within that set.
- If a preferred sub-agent is provided, treat it as the first routing candidate unless it clearly conflicts with the user request.
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
            
            full_prompt = f"""{prompt_text}
            
Supervisor Instruction: {instruction}

Relevant Context for your use (Cite if using):
{rag_context}
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
