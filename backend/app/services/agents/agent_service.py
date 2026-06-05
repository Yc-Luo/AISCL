"""Agent Service using LangGraph and Deep Agents Shim."""

import asyncio
import hashlib
import operator
from typing import Dict, Any, AsyncGenerator, Optional, List, Union, Annotated, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from app.core.config import settings
from app.core.llm_config import get_llm, resolve_role_model_id
from app.core.llm_runtime import get_group_lock, guarded_ainvoke, guarded_astream
from app.services.rag_service import rag_service
from app.services.research_event_service import research_event_service
from app.services.agents.deep_agents_shim import derive_routing_decision_from_context
from app.services.agents.multi_agent_roles import (
    AISCL_PLATFORM_GUIDE,
    PEDAGOGICAL_RESPONSE_CONTRACT,
    SUBAGENT_LABELS,
    get_research_subagents,
)
from app.services.agents.orchestration_planner import OrchestrationPlanner
from app.services.agents.think_tag_parser import ThinkTagParser


class StageAgentGraphState(TypedDict, total=False):
    """Runtime state for stage-aware multi-agent graph execution."""

    active_agents: List[str]
    agent_name: str
    agent_index: int
    subagents: Dict[str, Dict[str, Any]]
    message: str
    plan: Dict[str, Any]
    context: Dict[str, Any]
    mode: str
    events: Annotated[List[Dict[str, Any]], operator.add]
    final_sections: Annotated[List[str], operator.add]
    processing_summaries: Annotated[List[str], operator.add]
    agent_outputs: Annotated[List[Dict[str, str]], operator.add]


class AgentService:
    """Service to manage AI Agents via LangGraph."""

    def __init__(self):
        """Initialize Graph state."""
        self.llm = None
        self.graph = None
        self._current_model_id = None
        self._current_llm_signature = None

    async def initialize(self):
        """Async Initialization for the graph and LLM with hot-reload support."""
        # 1. Resolve latest model config from selected config source
        latest_llm_signature = None
        if settings.LLM_CONFIG_SOURCE.lower() == "db":
            try:
                from app.repositories.system_config import SystemConfig
                config_keys = [
                    "llm_provider",
                    "llm_model",
                    "llm_base_url",
                    "llm_key",
                    "user_custom_models",
                    "llm_role_model_map",
                ]
                config_values = {}
                for key in config_keys:
                    config = await SystemConfig.find_one(SystemConfig.key == key)
                    config_values[key] = config.value if config else ""
                supervisor_model_id = await resolve_role_model_id("langgraph_supervisor")
                latest_model_id = supervisor_model_id or config_values.get("llm_model") or (
                    settings.OPENAI_MODEL if settings.LLM_PROVIDER == "openai"
                    else settings.DEEPSEEK_MODEL if settings.LLM_PROVIDER in ["deepseek", "deepseek-chat"]
                    else settings.OLLAMA_MODEL if settings.LLM_PROVIDER == "ollama"
                    else settings.OPENAI_MODEL
                )
                latest_llm_signature = hashlib.sha256(
                    "|".join(str(config_values.get(key, "")) for key in config_keys).encode("utf-8")
                ).hexdigest()
            except Exception:
                latest_model_id = (
                    settings.OPENAI_MODEL if settings.LLM_PROVIDER == "openai"
                    else settings.DEEPSEEK_MODEL if settings.LLM_PROVIDER in ["deepseek", "deepseek-chat"]
                    else settings.OLLAMA_MODEL if settings.LLM_PROVIDER == "ollama"
                    else settings.OPENAI_MODEL
                )
        else:
            latest_model_id = (
                settings.OPENAI_MODEL if settings.LLM_PROVIDER == "openai"
                else settings.DEEPSEEK_MODEL if settings.LLM_PROVIDER in ["deepseek", "deepseek-chat"]
                else settings.OLLAMA_MODEL if settings.LLM_PROVIDER == "ollama"
                else settings.OPENAI_MODEL
            )
        if latest_llm_signature is None:
            latest_llm_signature = hashlib.sha256(
                "|".join(
                    [
                        settings.LLM_PROVIDER,
                        latest_model_id,
                        settings.OPENAI_BASE_URL,
                        settings.DEEPSEEK_BASE_URL,
                        settings.OLLAMA_BASE_URL,
                        settings.OPENAI_API_KEY,
                        settings.DEEPSEEK_API_KEY,
                    ]
                ).encode("utf-8")
            ).hexdigest()

        # 2. Check if we need to reload (Hot Update Logic)
        if not self.llm or self._current_llm_signature != latest_llm_signature:
            print(f"🔄 Detected model change or first init: {self._current_model_id} -> {latest_model_id}")
            self.llm = await get_llm(
                temperature=0.7,
                model_id=await resolve_role_model_id("langgraph_supervisor"),
            )
            self._current_model_id = latest_model_id
            self._current_llm_signature = latest_llm_signature
            # Invalidation: Force graph rebuild
            self.graph = None

        # 3. Build graph if missing
        if not self.graph:
            self.graph = await self._build_graph()

    def _get_research_subagents(self) -> List[Dict[str, Any]]:
        """Return the canonical research sub-agent definitions."""
        return get_research_subagents()

    def _resolve_rag_plan(
        self,
        *,
        context: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Choose retrieval strategy after deterministic routing, not before it.

        This is intentionally conservative for the experiment system:
        - group chat AI (`source_actor_type=ai_assistant`) uses role-aware retrieval
        - other AI entry points keep broader retrieval unless the role is clearly process-only
        """
        merged_context = context or {}
        routing_decision = derive_routing_decision_from_context(
            subagents=self._get_research_subagents(),
            context=merged_context,
        )
        selected_subagent = (
            routing_decision.get("selected_subagent")
            if routing_decision
            else None
        )
        source_actor_type = merged_context.get("source_actor_type")

        if selected_subagent == "evidence_researcher":
            return {
                "should_retrieve": True,
                "max_results": 4,
                "retrieval_mode": "role_aware_full",
                "source_types": ["wiki", "resource"],
                "wiki_item_types": ["task_brief", "concept", "evidence", "stage_summary"],
                "selected_subagent": selected_subagent,
                "routing_decision": routing_decision,
            }

        if selected_subagent == "viewpoint_challenger":
            return {
                "should_retrieve": True,
                "max_results": 2,
                "retrieval_mode": "role_aware_targeted",
                "source_types": ["wiki", "resource"],
                "wiki_item_types": ["claim", "controversy", "evidence"],
                "selected_subagent": selected_subagent,
                "routing_decision": routing_decision,
            }

        if selected_subagent == "feedback_prompter":
            diagnosis = (routing_decision or {}).get("collaboration_diagnosis") or {}
            should_include_resources = diagnosis.get("knowledge_construct") == "explanation_integration"
            return {
                "should_retrieve": True,
                "max_results": 2,
                "retrieval_mode": "role_aware_revision",
                "source_types": ["wiki", "resource"] if should_include_resources else ["wiki"],
                "wiki_item_types": ["claim", "evidence", "stage_summary"],
                "selected_subagent": selected_subagent,
                "routing_decision": routing_decision,
            }

        if source_actor_type == "ai_assistant" and selected_subagent == "problem_progressor":
            return {
                "should_retrieve": False,
                "max_results": 0,
                "retrieval_mode": "role_aware_skip",
                "source_types": [],
                "wiki_item_types": [],
                "selected_subagent": selected_subagent,
                "routing_decision": routing_decision,
            }

        return {
            "should_retrieve": True,
            "max_results": 3,
            "retrieval_mode": "default_full",
            "source_types": ["wiki", "resource"],
            "wiki_item_types": ["task_brief", "concept", "evidence", "claim", "controversy", "stage_summary"],
            "selected_subagent": selected_subagent,
            "routing_decision": routing_decision,
        }

    async def _build_graph(self):
        """Construct the Multi-Agent System using Deep Agents."""
        # Use our shim to support Deep Agents architecture on current/future envs
        from app.services.agents.deep_agents_shim import create_deep_agent
        
        # 1. Define Sub-Agents (Roles)
        subagents = self._get_research_subagents()
        
        # 2. Define Main System Prompt (Supervisor)
        system_prompt = """你现在是 AISCL 协作学习平台中的“支架路由协调器”。
你的职责不是直接包办回答，而是在一般线上小组协作学习对话中，把成员当前的问题路由给最合适的支架角色，保证支架介入符合阶段目标、规则诊断和开放角色配置。

路由原则：
- 优先参考当前学习阶段、当前命中的规则类型以及当前开放的支架角色。
- 当学习者表现出焦虑、沉默、冲突、低动机、怕做错或觉得任务太难时，优先进入“情绪与动机协调”：由“问题推进者”降低任务压力并切分行动，必要时让“反馈追问者”追问最小修订点。
- 当学习者需要资料线索、来源判断或背景知识时，优先分配给“资料研究员”。
- 当学习者需要反驳、替代解释或观点比较时，优先分配给“观点挑战者”。
- 当学习者需要追问证据、评价标准或修订方向时，优先分配给“反馈追问者”。
- 当学习者需要澄清任务、识别阶段目标或推进下一步时，优先分配给“问题推进者”。
- 如果上下文中有项目资料或资源检索结果，应优先让回答建立在这些材料上，而不是空泛生成。
- 所有回应都必须使用中文。
- 严禁向用户推荐平台外的协作产品或替代平台。

""" + PEDAGOGICAL_RESPONSE_CONTRACT
        
        # 3. Create the Deep Agent Graph
        return create_deep_agent(
            model=self.llm,
            subagents=subagents,
            system_prompt=system_prompt
        )

    async def chat_stream(
        self, 
        persona_key: str, 
        message: str, 
        session_id: str,
        subject: str = "General",
        context: Optional[Dict[str, Any]] = None,
    ) -> AsyncGenerator[Union[str, Dict[str, Any]], None]:
        """Stream response using the Graph."""
        
        # Initialize graph if needed (Double Check Locking Pattern in Production)
        if not self.graph:
            await self.initialize()

        group_lock = None
        if context and not context.get("_group_lock_acquired"):
            if context.get("source_actor_type") == "ai_assistant":
                group_lock = get_group_lock(context.get("group_id") or context.get("project_id"))
        if group_lock:
            async with group_lock:
                locked_context = {**context, "_group_lock_acquired": True}
                async for item in self.chat_stream(
                    persona_key=persona_key,
                    message=message,
                    session_id=session_id,
                    subject=subject,
                    context=locked_context,
                ):
                    yield item
            return

        if self._is_stage_aware_graph(context):
            async for event in self._chat_stream_stage_aware(
                persona_key=persona_key,
                message=message,
                session_id=session_id,
                subject=subject,
                context=context,
            ):
                yield event
            return

        # Role-aware retrieval plan: route first, then decide whether retrieval is needed.
        resolved_project_id = (
            context.get("project_id")
            if context and context.get("project_id")
            else session_id.split(":")[0]
        )
        routing_context = {**(context or {}), "current_message": message}
        rag_plan = self._resolve_rag_plan(context=routing_context)
        rag_results = {"content": "", "citations": []}
        if rag_plan["should_retrieve"]:
            rag_results = await rag_service.retrieve_context(
                project_id=resolved_project_id,
                query=message,
                max_results=rag_plan["max_results"],
                group_id=context.get("group_id") if context else None,
                stage_id=context.get("current_stage") if context else None,
                user_id=context.get("user_id") if context else None,
                actor_type=(
                    context.get("source_actor_type")
                    if context and context.get("source_actor_type")
                    else "ai_assistant"
                ),
                room_id=context.get("room_id") if context else None,
                experiment_version_id=(
                    context.get("experiment_version_id")
                    if context
                    else None
                ),
                source_types=rag_plan.get("source_types"),
                wiki_item_types=rag_plan.get("wiki_item_types"),
            )
        
        merged_context = {
            "subject": subject,
            "rag_context": rag_results.get("content", ""),
            "rag_citations": rag_results.get("citations", []),
            "retrieval_mode": rag_plan["retrieval_mode"],
            "preselected_subagent": rag_plan.get("selected_subagent"),
        }
        if context:
            merged_context.update(context)
        if rag_plan.get("routing_decision"):
            merged_context["collaboration_diagnosis"] = rag_plan["routing_decision"].get("collaboration_diagnosis")
            merged_context["preselected_subagent"] = rag_plan["routing_decision"].get("selected_subagent")

        inputs = {
            "messages": [HumanMessage(content=message)],
            "plan": [], # State will persist if checkpointer used
            "context": merged_context,
            "scratchpad": ""
        }

        config = {"configurable": {"thread_id": session_id}}
        routing_decision = None
        intervention_mode = None
        fallback_routing_decision = derive_routing_decision_from_context(
            subagents=self._get_research_subagents(),
            context=merged_context,
        )
        
        # Execute Graph
        async for event in self.graph.astream_events(inputs, version="v1", config=config):
            kind = event["event"]
            node_name = event.get("metadata", {}).get("langgraph_node", "")
            if kind == "on_chain_end":
                data = event.get("data", {}) or {}
                candidate_outputs = []
                if isinstance(data, dict):
                    if isinstance(data.get("output"), dict):
                        candidate_outputs.append(data.get("output"))
                    candidate_outputs.append(data)
                for candidate in candidate_outputs:
                    if isinstance(candidate, dict) and candidate.get("routing_decision"):
                        routing_decision = candidate.get("routing_decision")
                        intervention_mode = candidate.get("intervention_mode")
                        break
            if kind == "on_chat_model_stream":
                # Filter supervisor thinking
                if node_name == "supervisor":
                    continue
                    
                content = event["data"]["chunk"].content
                if content:
                    yield content

        effective_routing_decision = routing_decision or fallback_routing_decision
        effective_intervention_mode = intervention_mode or (
            effective_routing_decision.get("intervention_mode")
            if effective_routing_decision
            else None
        )

        if effective_routing_decision:
            experiment_version_id = None
            if context:
                experiment_version_id = (
                    context.get("experiment_version_id")
                    or context.get("experiment_version")
                    or context.get("version_name")
                )
            await research_event_service.record_batch_events(
                events=[
                    {
                        "project_id": resolved_project_id,
                        "experiment_version_id": experiment_version_id,
                        "room_id": context.get("room_id") if context else None,
                        "group_id": context.get("group_id") if context else None,
                        "user_id": context.get("user_id") if context else None,
                        "actor_type": context.get("source_actor_type") if context and context.get("source_actor_type") else "system",
                        "event_domain": "scaffold",
                        "event_type": "graph_routing_decision",
                        "stage_id": context.get("current_stage") if context else None,
                        "payload": {
                            **effective_routing_decision,
                            "intervention_mode": effective_intervention_mode,
                            "retrieval_mode": merged_context.get("retrieval_mode"),
                            "session_id": session_id,
                            "message_length": len(message or ""),
                            "decision_source": "graph_event" if routing_decision else "context_fallback",
                        },
                    }
                ],
                current_user_id=context.get("user_id") if context else None,
            )

    def _is_stage_aware_graph(self, context: Optional[Dict[str, Any]]) -> bool:
        graph_version = str((context or {}).get("graph_version") or "").strip()
        ai_scaffold_mode = str((context or {}).get("ai_scaffold_mode") or "").strip()
        if graph_version == "research-graph-v3-stage-aware":
            return True
        # Older local/cloud projects often have multi_agent enabled before graph_version existed.
        # Treat the missing value as the current v3 graph, while preserving explicit legacy versions.
        return ai_scaffold_mode == "multi_agent" and not graph_version

    async def _chat_stream_stage_aware(
        self,
        persona_key: str,
        message: str,
        session_id: str,
        subject: str = "General",
        context: Optional[Dict[str, Any]] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Stage-aware multi-agent orchestration with structured streaming events."""
        context = context or {}
        resolved_project_id = context.get("project_id") or session_id.split(":")[0]
        subagents = {item["name"]: item for item in self._get_research_subagents()}
        plan = OrchestrationPlanner.plan(
            message=message,
            current_stage=context.get("current_stage"),
            rule_type=context.get("rule_type"),
            preferred_subagent=context.get("preferred_subagent"),
            enabled_subagents=context.get("enabled_subagents"),
            enabled_scaffold_roles=context.get("enabled_scaffold_roles"),
        )
        active_agents = [agent for agent in plan["active_agents"] if agent in subagents]
        if not active_agents:
            active_agents = ["problem_progressor"]
            plan = {**plan, "active_agents": active_agents, "selected_subagent": "problem_progressor"}
        if plan.get("orchestration_mode") == "debate" and len(active_agents) > 3:
            active_agents = active_agents[:3]
            plan = {**plan, "active_agents": active_agents}

        rag_plan = self._resolve_stage_aware_rag_plan(plan=plan, context=context)
        yield {
            "type": "process_start",
            "message": "正在判断当前问题需要哪类学习支持。",
        }
        yield {
            "type": "process_step",
            "message": f"当前更接近“{plan.get('knowledge_construct_label')}”，需要关注“{plan.get('regulation_construct_label')}”。",
        }
        rag_results = {"content": "", "citations": []}
        if rag_plan["should_retrieve"]:
            try:
                yield {
                    "type": "retrieval_step",
                    "message": "正在检查项目资料、Wiki 和任务说明是否能支持本轮回答。",
                }
                rag_results = await rag_service.retrieve_context(
                    project_id=resolved_project_id,
                    query=message,
                    max_results=rag_plan["max_results"],
                    group_id=context.get("group_id"),
                    stage_id=plan.get("normalized_stage") or context.get("current_stage"),
                    user_id=context.get("user_id"),
                    actor_type=context.get("source_actor_type") or "ai_assistant",
                    room_id=context.get("room_id"),
                    experiment_version_id=context.get("experiment_version_id"),
                    source_types=rag_plan.get("source_types"),
                    wiki_item_types=rag_plan.get("wiki_item_types"),
                )
                yield {
                    "type": "retrieval_step",
                    "message": (
                        "已找到可引用的项目资料或知识卡片。"
                        if rag_results.get("citations")
                        else "项目资料暂未命中，本轮不会假设资源库或 Wiki 已有内容。"
                    ),
                }
            except Exception as exc:
                rag_results = {"content": "", "citations": []}
                yield {
                    "type": "retrieval_step",
                    "message": "项目资料检索暂不可用，正在基于当前任务与协作记忆回应。",
                    "detail": str(exc),
                }
        else:
            yield {
                "type": "retrieval_step",
                "message": "本轮优先基于任务说明、阶段记忆和小组状态回应，不额外检索资料。",
            }

        merged_context = {
            **context,
            "subject": subject,
            "rag_context": rag_results.get("content", ""),
            "rag_citations": rag_results.get("citations", []),
            "retrieval_mode": rag_plan["retrieval_mode"],
            "collaboration_diagnosis": {
                "knowledge_construct": plan["knowledge_construct"],
                "knowledge_construct_label": plan["knowledge_construct_label"],
                "regulation_construct": plan["regulation_construct"],
                "regulation_construct_label": plan["regulation_construct_label"],
                "support_need": plan["support_need"],
                "answer_policy": plan["answer_policy"],
                "primary_subagent": plan["selected_subagent"],
            },
        }
        mode = plan["orchestration_mode"]
        ai_meta = self._build_ai_meta(plan=plan, rag_plan=rag_plan)
        yield {
            "type": "routing",
            "routing_decision": plan,
            "ai_meta": ai_meta,
            "retrieval_mode": rag_plan["retrieval_mode"],
            "citation_count": len(rag_results.get("citations", [])),
        }
        yield {
            "type": "routing_step",
            "message": f"本轮采用“{self._mode_label(mode)}”，主要由“{SUBAGENT_LABELS.get(plan.get('selected_subagent'), 'AI智能助手')}”组织回应。",
        }

        if mode == "parallel" and len(active_agents) > 1:
            yield {
                "type": "status",
                "message": "正在并行组织多个智能体视角。",
                "orchestration_mode": mode,
            }
        execution = await self._execute_stage_aware_agents(
            active_agents=active_agents,
            subagents=subagents,
            message=message,
            plan=plan,
            context=merged_context,
            mode=mode,
        )
        for event in execution["events"]:
            yield event
        final_sections: List[str] = execution["final_sections"]
        processing_summaries: List[str] = execution["processing_summaries"]

        final_content = await self._synthesize_stage_agent_outputs(
            message=message,
            plan=plan,
            context=merged_context,
            mode=mode,
            final_sections=final_sections,
        )
        if not final_content:
            fallback_agent = active_agents[0]
            fallback_text = "我先帮你们把当前问题收束一下：请明确本轮要判断的核心问题、已有依据和下一步分工。"
            final_content = fallback_text
            yield {
                "type": "output",
                "agent": fallback_agent,
                "label": SUBAGENT_LABELS.get(fallback_agent, fallback_agent),
                "content": fallback_text,
            }

        ai_meta["processing_summary"] = self._dedupe_processing_summary(
            ai_meta.get("processing_summary", []) + processing_summaries
        )
        if len([section for section in final_sections if section.strip()]) > 1:
            ai_meta["processing_summary"] = self._dedupe_processing_summary(
                ai_meta["processing_summary"] + ["已将多个智能体视角整合为一条小组可读支架。"]
            )
        yield {
            "type": "process_done",
            "message": "已完成支架选择和回答生成。",
        }
        yield {
            "type": "done",
            "final_content": final_content,
            "ai_meta": ai_meta,
            "routing_decision": plan,
            "citation_count": len(rag_results.get("citations", [])),
        }

        await self._record_graph_routing_event(
            project_id=resolved_project_id,
            session_id=session_id,
            message=message,
            context=context,
            plan=plan,
            retrieval_mode=rag_plan["retrieval_mode"],
            graph_runtime=execution.get("graph_runtime"),
            final_section_count=len([section for section in final_sections if section.strip()]),
            synthesis_applied=(
                mode != "single"
                and len([section for section in final_sections if section.strip()]) > 1
            ),
        )

    async def _execute_stage_aware_agents(
        self,
        *,
        active_agents: List[str],
        subagents: Dict[str, Dict[str, Any]],
        message: str,
        plan: Dict[str, Any],
        context: Dict[str, Any],
        mode: str,
    ) -> Dict[str, Any]:
        """Execute the planned agent mode through a LangGraph StateGraph."""
        try:
            return await self._execute_stage_aware_langgraph(
                active_agents=active_agents,
                subagents=subagents,
                message=message,
                plan=plan,
                context=context,
                mode=mode,
            )
        except Exception:
            return await self._execute_stage_aware_agents_legacy(
                active_agents=active_agents,
                subagents=subagents,
                message=message,
                plan=plan,
                context=context,
                mode=mode,
            )

    async def _execute_stage_aware_agents_legacy(
        self,
        *,
        active_agents: List[str],
        subagents: Dict[str, Dict[str, Any]],
        message: str,
        plan: Dict[str, Any],
        context: Dict[str, Any],
        mode: str,
    ) -> Dict[str, Any]:
        """Fallback executor used if LangGraph compilation/runtime fails."""
        if mode == "parallel" and len(active_agents) > 1:
            tasks = [
                self._collect_stage_agent_events(
                    agent_name=agent_name,
                    index=index,
                    subagents=subagents,
                    message=message,
                    plan=plan,
                    context=context,
                    previous_outputs={},
                    mode=mode,
                )
                for index, agent_name in enumerate(active_agents)
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            return self._merge_agent_execution_results(
                results=results,
                active_agents=active_agents,
                mode=mode,
            )

        final_sections: List[str] = []
        processing_summaries: List[str] = []
        previous_outputs: Dict[str, str] = {}
        events: List[Dict[str, Any]] = []
        agents_to_run = active_agents[:3] if mode == "debate" else active_agents

        for index, agent_name in enumerate(agents_to_run):
            result = await self._collect_stage_agent_events(
                agent_name=agent_name,
                index=index,
                subagents=subagents,
                message=message,
                plan=plan,
                context=context,
                previous_outputs=previous_outputs,
                mode=mode,
            )
            events.extend(result["events"])
            processing_summaries.extend(result["processing_summaries"])
            previous_outputs[agent_name] = result["agent_output"]
            if result["section_text"].strip():
                final_sections.append(result["section_text"])
            if mode == "single":
                break

        return {
            "events": events,
            "final_sections": final_sections,
            "processing_summaries": processing_summaries,
            "graph_runtime": "legacy_fallback",
        }

    async def _execute_stage_aware_langgraph(
        self,
        *,
        active_agents: List[str],
        subagents: Dict[str, Dict[str, Any]],
        message: str,
        plan: Dict[str, Any],
        context: Dict[str, Any],
        mode: str,
    ) -> Dict[str, Any]:
        """Build and run a per-request StateGraph using Send for parallel fan-out."""

        async def run_agent_node(state: StageAgentGraphState) -> StageAgentGraphState:
            agent_name = state["agent_name"]
            agent_outputs = state.get("agent_outputs", [])
            previous_outputs = {
                item.get("agent", ""): item.get("output", "")
                for item in agent_outputs
                if item.get("agent")
            }
            result = await self._collect_stage_agent_events(
                agent_name=agent_name,
                index=state.get("agent_index", 0),
                subagents=state["subagents"],
                message=state["message"],
                plan=state["plan"],
                context=state["context"],
                previous_outputs=previous_outputs,
                mode=state["mode"],
            )
            return {
                "events": result["events"],
                "final_sections": [result["section_text"]] if result["section_text"].strip() else [],
                "processing_summaries": result["processing_summaries"],
                "agent_outputs": [{"agent": agent_name, "output": result["agent_output"]}],
            }

        graph = StateGraph(StageAgentGraphState)

        if mode == "parallel" and len(active_agents) > 1:
            def fanout(state: StageAgentGraphState) -> List[Send]:
                return [
                    Send(
                        "run_agent",
                        {
                            **state,
                            "agent_name": agent_name,
                            "agent_index": index,
                            "agent_outputs": [],
                        },
                    )
                    for index, agent_name in enumerate(state["active_agents"])
                ]

            graph.add_node("fanout", lambda state: {})
            graph.add_node("run_agent", run_agent_node)
            graph.add_edge(START, "fanout")
            graph.add_conditional_edges("fanout", fanout, ["run_agent"])
            graph.add_edge("run_agent", END)
        else:
            agents_to_run = active_agents[:3] if mode == "debate" else active_agents
            previous_node = START
            for index, agent_name in enumerate(agents_to_run):
                node_name = f"run_{index}_{agent_name}"

                async def sequential_node(
                    state: StageAgentGraphState,
                    *,
                    current_agent: str = agent_name,
                    current_index: int = index,
                ) -> StageAgentGraphState:
                    next_state: StageAgentGraphState = {
                        **state,
                        "agent_name": current_agent,
                        "agent_index": current_index,
                    }
                    return await run_agent_node(next_state)

                graph.add_node(node_name, sequential_node)
                graph.add_edge(previous_node, node_name)
                previous_node = node_name
                if mode == "single":
                    break
            graph.add_edge(previous_node, END)

        compiled = graph.compile()
        result = await compiled.ainvoke({
            "active_agents": active_agents,
            "subagents": subagents,
            "message": message,
            "plan": plan,
            "context": context,
            "mode": mode,
            "events": [],
            "final_sections": [],
            "processing_summaries": [],
            "agent_outputs": [],
        })

        return {
            "events": result.get("events", []),
            "final_sections": result.get("final_sections", []),
            "processing_summaries": result.get("processing_summaries", []),
            "graph_runtime": (
                "langgraph_stategraph_send"
                if mode == "parallel" and len(active_agents) > 1
                else "langgraph_stategraph_sequence"
            ),
        }

    async def _synthesize_stage_agent_outputs(
        self,
        *,
        message: str,
        plan: Dict[str, Any],
        context: Dict[str, Any],
        mode: str,
        final_sections: List[str],
    ) -> str:
        """Merge multi-agent outputs into one low-burden scaffold for students."""
        sections = [section.strip() for section in final_sections if section and section.strip()]
        if not sections:
            return ""
        if mode == "single" or len(sections) == 1:
            return sections[0]

        raw_joined = "\n\n".join(sections).strip()

        try:
            llm = await get_llm(
                temperature=0.25,
                model_id=await resolve_role_model_id("answer_synthesizer"),
            )
            response = await guarded_ainvoke(
                llm,
                [
                    SystemMessage(
                        content=(
                            "你是 AISCL 的反馈整合节点。你的任务是把多个支架智能体的候选回应"
                            "整合成一条学生端可读的小组协作支架。不要暴露内部角色争论、路由、"
                            "模型配置或调试信息。"
                        )
                    ),
                    HumanMessage(
                        content=f"""学生/小组本轮消息：
{message}

支架编排：
- 模式：{mode}
- 阶段：{plan.get("knowledge_construct_label") or "未识别"}
- 调节重点：{plan.get("regulation_construct_label") or "未识别"}
- 支架需要：{plan.get("support_need") or "未识别"}

小组态势记忆：
{self._clip_context(context.get("group_state_context"), 900)}

阶段记忆：
{self._clip_context(context.get("stage_memory_context"), 900)}

候选回应：
{self._clip_context(raw_joined, 4200)}

请整合成一条学生端可读的中文回复，保持原来的“多智能体小组提示”观感：
- 顶部角色卡片和“思考路径”由前端展示，正文里不要重复写“问题推进者/资料研究员/观点挑战者/反馈追问者”等角色标题。
- 不要使用 #、##、### 标题、分割线、表格、JSON、长编号目录或内部路由标签。
- 第一段用 1-2 句温和点明当前处境，不要空泛夸奖。
- 正文优先使用 2-3 个加粗小标题组织，每个标题后接短段或少量行动项。常用标题为：
  **你们当前最需要做的是：**
  **下一步行动建议：**
  **一个可以继续讨论的问题：**
- 如果是平台操作或故障问题，可改用：
  **可以这样操作：**
  **如果还失败：**
- 使用平等、互帮互助的线上小组协作语气，保留必要的证据核验、反例或修订提醒。
- 如提到成员姓名，姓名后加“同学”。
- 不替小组完成最终答案。
- 字数通常 350-900 字，复杂问题最多 1200 字。"""
                    ),
                ],
            )
            content = response.content if hasattr(response, "content") else str(response)
            cleaned = str(content or "").strip()
            return cleaned or raw_joined
        except Exception:
            return raw_joined

    async def _collect_stage_agent_events(
        self,
        *,
        agent_name: str,
        index: int,
        subagents: Dict[str, Dict[str, Any]],
        message: str,
        plan: Dict[str, Any],
        context: Dict[str, Any],
        previous_outputs: Dict[str, str],
        mode: str,
    ) -> Dict[str, Any]:
        label = SUBAGENT_LABELS.get(agent_name, agent_name)
        section_prefix = self._section_prefix(mode=mode, agent_name=agent_name, index=index)
        events: List[Dict[str, Any]] = []
        processing_summaries: List[str] = []
        agent_output = ""

        if section_prefix:
            events.append({"type": "output", "agent": agent_name, "label": label, "content": section_prefix})
        events.append({"type": "output_start", "agent": agent_name, "label": label})
        async for event in self._stream_single_agent(
            agent_def=subagents[agent_name],
            message=message,
            instruction=(plan.get("agent_instructions") or {}).get(agent_name, ""),
            context=context,
            previous_outputs=previous_outputs,
            mode=mode,
        ):
            if event["type"] == "output":
                agent_output += event.get("content", "")
            elif event["type"] == "thinking":
                # Do not expose raw model thinking. Public process steps are
                # generated deterministically by the orchestration layer.
                continue
            events.append(event)
        events.append({"type": "output_end", "agent": agent_name, "label": label})

        return {
            "events": events,
            "agent_output": agent_output.strip(),
            "section_text": (section_prefix or "") + agent_output.strip(),
            "processing_summaries": processing_summaries,
        }

    def _merge_agent_execution_results(
        self,
        *,
        results: List[Any],
        active_agents: List[str],
        mode: str,
    ) -> Dict[str, Any]:
        events: List[Dict[str, Any]] = []
        final_sections: List[str] = []
        processing_summaries: List[str] = []

        for index, result in enumerate(results):
            agent_name = active_agents[index]
            label = SUBAGENT_LABELS.get(agent_name, agent_name)
            if isinstance(result, Exception):
                fallback_text = f"**{label}**\n\n本轮{label}暂时无法生成完整回应，请先围绕当前问题补充依据并明确下一步分工。"
                events.extend([
                    {"type": "output_start", "agent": agent_name, "label": label},
                    {"type": "output", "agent": agent_name, "label": label, "content": fallback_text, "error": str(result)},
                    {"type": "output_end", "agent": agent_name, "label": label},
                ])
                final_sections.append(fallback_text)
                continue
            events.extend(result["events"])
            processing_summaries.extend(result["processing_summaries"])
            if result["section_text"].strip():
                final_sections.append(result["section_text"])

        return {
            "events": events,
            "final_sections": final_sections,
            "processing_summaries": processing_summaries,
            "graph_runtime": "legacy_fallback",
        }

    async def _stream_single_agent(
        self,
        *,
        agent_def: Dict[str, Any],
        message: str,
        instruction: str,
        context: Dict[str, Any],
        previous_outputs: Dict[str, str],
        mode: str,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        agent_name = agent_def["name"]
        label = SUBAGENT_LABELS.get(agent_name, agent_name)
        parser = ThinkTagParser(agent=agent_name, label=label)
        visible_output_seen = False
        thinking_buffer = ""
        prompt = ChatPromptTemplate.from_messages([
            ("system", self._build_stage_aware_agent_prompt(
                agent_def=agent_def,
                instruction=instruction,
                context=context,
                previous_outputs=previous_outputs,
                mode=mode,
            )),
            ("human", "{input}"),
        ])
        role_model_id = await resolve_role_model_id(
            agent_name,
            fallback_model_id=context.get("runtime_model_id"),
        )
        runtime_llm = await get_llm(
            temperature=0.7,
            model_id=role_model_id,
        )
        chain = prompt | runtime_llm
        try:
            async for chunk in guarded_astream(chain, {"input": message}):
                content = getattr(chunk, "content", "") or ""
                if not content:
                    continue
                for event in parser.feed(str(content)):
                    if event["type"] == "thinking":
                        thinking_buffer += event.get("content", "")
                    if event["type"] == "output" and event.get("content", "").strip():
                        visible_output_seen = True
                    yield event
        except Exception as exc:
            yield {
                "type": "output",
                "agent": agent_name,
                "label": label,
                "content": f"本轮{label}暂时无法完整生成。我先给出最小建议：围绕当前问题补充依据、明确判断标准，并把下一步分工写入协作文档。",
                "error": str(exc),
            }
        flush_events = parser.flush()
        for event in flush_events:
            if event["type"] == "thinking":
                thinking_buffer += event.get("content", "")
            if event["type"] == "output" and event.get("content", "").strip():
                visible_output_seen = True
            yield event
        if not visible_output_seen:
            promoted_answer = self._promote_unclosed_thinking_as_answer(thinking_buffer)
            if promoted_answer:
                yield {
                    "type": "output",
                    "agent": agent_name,
                    "label": label,
                    "content": promoted_answer,
                    "promoted_from_unclosed_think": True,
                }

    def _build_stage_aware_agent_prompt(
        self,
        *,
        agent_def: Dict[str, Any],
        instruction: str,
        context: Dict[str, Any],
        previous_outputs: Dict[str, str],
        mode: str,
    ) -> str:
        diagnosis = context.get("collaboration_diagnosis") or {}
        rag_context = context.get("rag_context")
        rag_citations = context.get("rag_citations") or []
        if rag_context or rag_citations:
            web_citation_count = len([
                citation for citation in rag_citations
                if (citation.get("resource_type") or citation.get("source_type")) == "web"
            ])
            if web_citation_count and web_citation_count == len(rag_citations):
                source_availability_note = "本轮项目资料/Wiki没有命中，已使用联网搜索作为外部资料兜底；回答时要明确这是外部网页线索，需要学习者核验。"
            elif web_citation_count:
                source_availability_note = "本轮同时检索到项目资料/Wiki和外部网页线索；优先使用项目内材料，网页线索只作补充核验。"
            else:
                source_availability_note = "本轮已检索到项目资料或 Wiki 引用，可基于这些来源提出核验和整理建议。"
        else:
            source_availability_note = (
                "本轮没有检索到项目资料或 Wiki 引用。不得暗示资源库/Wiki 已有内容可搜索；"
                "如需证据支持，应建议学习者先上传资料、创建 Wiki 卡片、补充选中文本或在协作文档中记录材料线索。"
            )
        previous_text = "\n\n".join(
            f"【{SUBAGENT_LABELS.get(agent, agent)}】\n{output}"
            for agent, output in previous_outputs.items()
            if output
        )
        return f"""{agent_def["system_prompt"]}

本轮编排模式：{mode}
本轮角色指令：{instruction}

过程诊断：
- 协作知识建构：{diagnosis.get("knowledge_construct_label") or "未识别"}
- 共享调节：{diagnosis.get("regulation_construct_label") or "未识别"}
- 支架需要：{diagnosis.get("support_need") or "未识别"}
- 回答策略：{diagnosis.get("answer_policy") or "brief_actionable"}

上下文材料：
平台功能速查：{AISCL_PLATFORM_GUIDE}
项目任务说明：{self._clip_context(context.get("project_task_context"), 1800)}
小组当前状态记忆：{self._clip_context(context.get("group_state_context"), 1800)}
阶段滚动记忆：{self._clip_context(context.get("stage_memory_context"), 1600)}
小组同伴讨论记忆：{self._clip_context(context.get("group_peer_context") or context.get("group_chat_context"), 1800)}
小组 AI 互动记忆：{self._clip_context(context.get("group_ai_context"), 1400)}
资料/Wiki可用性：{source_availability_note}
检索材料：{self._clip_context(rag_context, 2600)}
前序智能体输出：{self._clip_context(previous_text, 1800)}

输出要求：
- 不要输出 <think>、JSON、内部路由或调试字段；系统会单独生成学习者可读的“思考路径”。
- 无需展示详细推理链，直接给出面向小组成员的正式回答。
- 正式回答必须使用中文；保持原来的多智能体小组提示观感：顶部角色卡片由前端展示，正文里不要重复写角色名或内部编排信息。
- 不要使用 #、##、### 标题、分割线、表格、JSON、长编号目录或大段清单。
- 普通问题控制在 350-900 字；复杂整合或平台操作最多 1200 字。不要为了变短省略关键依据、步骤或同伴协作建议。
- 第一段用 1-2 句点明当前处境；正文优先使用 2-3 个加粗小标题，例如“**你们当前最需要做的是：**”“**下一步行动建议：**”“**一个可以继续讨论的问题：**”。
- 平台操作问题可以使用“**可以这样操作：**”“**如果还失败：**”，优先给清晰步骤。
- 协作论证问题优先给判断点、依据、下一步和一个可继续讨论的问题；不要为了凑结构重复无关提醒。
- 用平等协作、互帮互助的语气，不要像教师点评或课堂训导。
- 提到具体小组成员姓名时，姓名后要加“同学”，例如“张三同学的建议”；不要直接裸称姓名。
- 不替小组完成最终答案，不暴露实验条件、graph_version、规则 ID 或内部路由细节。
"""

    def _promote_unclosed_thinking_as_answer(self, text: str) -> str:
        """Recover user-facing answers accidentally emitted inside an unclosed think block."""
        cleaned = " ".join(str(text or "").replace("<think>", "").replace("</think>", "").split())
        if len(cleaned) < 80:
            return ""
        user_facing_markers = [
            "下一步",
            "建议",
            "请小组",
            "具体",
            "判断点",
            "进入",
            "可以",
            "需要",
            "**",
            "1.",
            "1、",
        ]
        if not any(marker in cleaned for marker in user_facing_markers):
            return ""
        reasoning_markers = [
            "我需要先分析",
            "让我思考",
            "用户意图",
            "内部推理",
            "不能透露",
        ]
        for marker in reasoning_markers:
            cleaned = cleaned.replace(marker, "")
        return cleaned[:900].strip()

    def _resolve_stage_aware_rag_plan(self, *, plan: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        agents = plan.get("active_agents") or []
        mode = plan.get("orchestration_mode")
        if plan.get("primary_subagent") == "problem_progressor" and mode == "single":
            return {
                "should_retrieve": False,
                "max_results": 0,
                "retrieval_mode": "role_aware_skip",
                "source_types": [],
                "wiki_item_types": [],
            }
        if "evidence_researcher" in agents or mode in {"parallel", "pipeline"}:
            return {
                "should_retrieve": True,
                "max_results": 4 if mode in {"parallel", "pipeline"} else 3,
                "retrieval_mode": f"stage_aware_{mode}",
                "source_types": ["wiki", "resource"],
                "wiki_item_types": ["task_brief", "concept", "evidence", "claim", "controversy", "stage_summary"],
            }
        if "viewpoint_challenger" in agents:
            return {
                "should_retrieve": True,
                "max_results": 2,
                "retrieval_mode": "role_aware_targeted",
                "source_types": ["wiki", "resource"],
                "wiki_item_types": ["claim", "controversy", "evidence"],
            }
        if "feedback_prompter" in agents:
            return {
                "should_retrieve": True,
                "max_results": 2,
                "retrieval_mode": "role_aware_revision",
                "source_types": ["wiki"],
                "wiki_item_types": ["claim", "evidence", "stage_summary"],
            }
        return {
            "should_retrieve": False,
            "max_results": 0,
            "retrieval_mode": "stage_aware_memory_only",
            "source_types": [],
            "wiki_item_types": [],
        }

    def _build_ai_meta(self, *, plan: Dict[str, Any], rag_plan: Dict[str, Any]) -> Dict[str, Any]:
        primary_agent = SUBAGENT_LABELS.get(plan.get("selected_subagent"), "AI智能助手")
        mode_label = self._mode_label(plan.get("orchestration_mode"))
        support_label = self._support_need_label(plan.get("support_need"))
        retrieval_label = self._retrieval_label(rag_plan.get("retrieval_mode"))
        return {
            "primary_agent": primary_agent,
            "primary_view": primary_agent,
            "rationale_summary": (
                f"本轮主要围绕“{plan.get('knowledge_construct_label')}”和"
                f"“{plan.get('regulation_construct_label')}”提供协作支架。"
            ),
            "routing_summary": [
                f"主要视角：{primary_agent}",
                f"支架重点：{support_label}",
                f"资料判断：{retrieval_label}",
            ],
            "processing_summary": [
                f"先判断当前问题更接近“{plan.get('knowledge_construct_label')}”。",
                f"再确认本轮需要关注“{support_label}”。",
                f"因此采用“{mode_label}”方式组织回应。",
            ],
            "orchestration_mode": plan.get("orchestration_mode"),
            "active_agents": plan.get("active_agents"),
        }

    def _section_prefix(self, *, mode: str, agent_name: str, index: int) -> str:
        if mode == "single":
            return ""
        label = SUBAGENT_LABELS.get(agent_name, agent_name)
        if mode == "pipeline":
            return f"**步骤 {index + 1}｜{label}**\n\n"
        if mode == "debate":
            return f"**第 {index + 1} 轮视角｜{label}**\n\n"
        return f"**{label}**\n\n"

    def _mode_label(self, mode: Optional[str]) -> str:
        return {
            "single": "单角色聚焦",
            "parallel": "多视角并行",
            "debate": "观点碰撞",
            "pipeline": "串联接力",
        }.get(mode or "", "协作支架")

    def _support_need_label(self, support_need: Optional[str]) -> str:
        return {
            "problem_framing": "澄清核心问题",
            "task_clarification": "澄清任务要求",
            "evidence_gap": "补充证据线索",
            "criteria_or_ai_peer_comparison": "明确比较标准",
            "multiple_view_generation": "生成多种观点",
            "counterargument_missing": "补充反例或反驳",
            "reasoning_or_integration_need": "整合理由与证据",
            "deep_inquiry_scaffold": "形成深度探究路径",
            "application_boundary_check": "检验方案边界",
            "strategy_or_action_need": "推进分工和行动",
            "emotion_or_participation_risk": "维持建设性参与",
            "platform_operation_help": "解决平台操作问题",
        }.get(support_need or "", "推进当前协作问题")

    def _retrieval_label(self, retrieval_mode: Optional[str]) -> str:
        mode = retrieval_mode or ""
        if "skip" in mode or "memory_only" in mode:
            return "优先使用任务说明和协作记忆，不额外检索资料"
        if "targeted" in mode:
            return "定向检查观点、争议和证据线索"
        if "revision" in mode:
            return "检查阶段结论和可修订材料"
        if "stage_aware" in mode or "full" in mode:
            return "检查项目资料、Wiki 和资源库是否有可用依据"
        return "按当前问题判断是否需要资料支持"

    def _clip_context(self, value: Any, limit: int) -> str:
        text = str(value or "").strip()
        if not text:
            return "none"
        return text if len(text) <= limit else f"{text[:limit]}..."

    def _dedupe_processing_summary(self, items: List[str]) -> List[str]:
        seen = set()
        result = []
        for item in items:
            normalized = " ".join(str(item or "").split())
            if normalized and normalized not in seen:
                seen.add(normalized)
                result.append(normalized[:160])
        return result[:8]

    async def _record_graph_routing_event(
        self,
        *,
        project_id: str,
        session_id: str,
        message: str,
        context: Dict[str, Any],
        plan: Dict[str, Any],
        retrieval_mode: str,
        graph_runtime: Optional[str] = None,
        final_section_count: int = 0,
        synthesis_applied: bool = False,
    ) -> None:
        await research_event_service.record_batch_events(
            events=[
                {
                    "project_id": project_id,
                    "experiment_version_id": context.get("experiment_version_id") or context.get("experiment_version") or context.get("version_name"),
                    "room_id": context.get("room_id"),
                    "group_id": context.get("group_id"),
                    "user_id": context.get("user_id"),
                    "actor_type": context.get("source_actor_type") or "system",
                    "event_domain": "scaffold",
                    "event_type": "graph_routing_decision",
                    "stage_id": context.get("current_stage"),
                    "payload": {
                        **plan,
                        "retrieval_mode": retrieval_mode,
                        "graph_runtime": graph_runtime,
                        "session_id": session_id,
                        "message_length": len(message or ""),
                        "scaffold_episode": {
                            "final_section_count": final_section_count,
                            "synthesis_applied": synthesis_applied,
                            "stage_memory_id": context.get("stage_memory_id"),
                            "stage_memory_version": context.get("stage_memory_version"),
                            "stage_memory_source_counts": context.get("stage_memory_source_counts"),
                            "group_state_memory_id": context.get("group_state_memory_id"),
                            "group_state_memory_version": context.get("group_state_memory_version"),
                            "group_state_source_counts": context.get("group_state_source_counts"),
                        },
                    },
                }
            ],
            current_user_id=context.get("user_id"),
        )

agent_service = AgentService()
