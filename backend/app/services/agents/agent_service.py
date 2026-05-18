"""Agent Service using LangGraph and Deep Agents Shim."""

import hashlib
from typing import Dict, Any, AsyncGenerator, Optional, List, Union

from langchain_core.messages import HumanMessage
from langchain_core.prompts import ChatPromptTemplate

from app.core.config import settings
from app.core.prompts.personas import PERSONAS
from app.core.llm_config import get_llm
from app.services.rag_service import rag_service
from app.services.research_event_service import research_event_service
from app.services.agents.deep_agents_shim import derive_routing_decision_from_context
from app.services.agents.orchestration_planner import OrchestrationPlanner, SUBAGENT_LABELS
from app.services.agents.think_tag_parser import ThinkTagParser


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
                ]
                config_values = {}
                for key in config_keys:
                    config = await SystemConfig.find_one(SystemConfig.key == key)
                    config_values[key] = config.value if config else ""
                latest_model_id = config_values.get("llm_model") or (
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
            self.llm = await get_llm(temperature=0.7)
            self._current_model_id = latest_model_id
            self._current_llm_signature = latest_llm_signature
            # Invalidation: Force graph rebuild
            self.graph = None

        # 3. Build graph if missing
        if not self.graph:
            self.graph = await self._build_graph()

    def _get_research_subagents(self) -> List[Dict[str, Any]]:
        """Return the canonical research sub-agent definitions."""
        return [
            {
                "name": "evidence_researcher",
                "description": "资料支持、来源核验、背景知识补给。优先服务证据补充与出处回查。",
                "system_prompt": PERSONAS["evidence_researcher"].messages[0].prompt.template,
            },
            {
                "name": "viewpoint_challenger",
                "description": "观点挑战、反驳生成、替代解释比较。优先服务反方观点与逻辑薄弱点暴露。",
                "system_prompt": PERSONAS["viewpoint_challenger"].messages[0].prompt.template,
            },
            {
                "name": "feedback_prompter",
                "description": "反馈追问、标准澄清、修订推进。优先服务证据充分性与判断修订。",
                "system_prompt": PERSONAS["feedback_prompter"].messages[0].prompt.template,
            },
            {
                "name": "problem_progressor",
                "description": "问题推进、阶段澄清、任务拆解。优先服务阶段目标明确与下一步行动。",
                "system_prompt": PERSONAS["problem_progressor"].messages[0].prompt.template,
            },
        ]

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
你的职责不是直接包办回答，而是把学习者当前的问题路由给最合适的支架角色，保证支架介入符合阶段目标、规则诊断和开放角色配置。

路由原则：
- 优先参考当前学习阶段、当前命中的规则类型以及当前开放的支架角色。
- 当学习者需要资料线索、来源判断或背景知识时，优先分配给“资料研究员”。
- 当学习者需要反驳、替代解释或观点比较时，优先分配给“观点挑战者”。
- 当学习者需要追问证据、评价标准或修订方向时，优先分配给“反馈追问者”。
- 当学习者需要澄清任务、识别阶段目标或推进下一步时，优先分配给“问题推进者”。
- 如果上下文中有项目资料或资源检索结果，应优先让回答建立在这些材料上，而不是空泛生成。
- 所有回应都必须使用中文。
- 严禁向用户推荐平台外的协作产品或替代平台。
"""
        
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
        return graph_version == "research-graph-v3-stage-aware"

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

        rag_plan = self._resolve_stage_aware_rag_plan(plan=plan, context=context)
        rag_results = {"content": "", "citations": []}
        if rag_plan["should_retrieve"]:
            try:
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
            except Exception as exc:
                rag_results = {"content": "", "citations": []}
                yield {
                    "type": "status",
                    "message": "项目资料检索暂不可用，正在基于当前任务与协作记忆回应。",
                    "detail": str(exc),
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
        ai_meta = self._build_ai_meta(plan=plan, rag_plan=rag_plan)
        yield {
            "type": "routing",
            "routing_decision": plan,
            "ai_meta": ai_meta,
            "retrieval_mode": rag_plan["retrieval_mode"],
            "citation_count": len(rag_results.get("citations", [])),
        }

        final_sections: List[str] = []
        processing_summaries: List[str] = []
        previous_outputs: Dict[str, str] = {}
        mode = plan["orchestration_mode"]

        for index, agent_name in enumerate(active_agents):
            label = SUBAGENT_LABELS.get(agent_name, agent_name)
            section_prefix = self._section_prefix(mode=mode, agent_name=agent_name, index=index)
            if section_prefix:
                yield {"type": "output", "agent": agent_name, "label": label, "content": section_prefix}
            agent_output = ""
            yield {"type": "output_start", "agent": agent_name, "label": label}
            async for event in self._stream_single_agent(
                agent_def=subagents[agent_name],
                message=message,
                instruction=(plan.get("agent_instructions") or {}).get(agent_name, ""),
                context=merged_context,
                previous_outputs=previous_outputs,
                mode=mode,
            ):
                if event["type"] == "output":
                    agent_output += event.get("content", "")
                elif event["type"] == "thinking":
                    processing_summaries.append(f"{label}: {event.get('content', '').strip()}")
                yield event
            yield {"type": "output_end", "agent": agent_name, "label": label}
            previous_outputs[agent_name] = agent_output.strip()
            final_sections.append((section_prefix or "") + agent_output.strip())
            if mode == "single":
                break

        final_content = "\n\n".join(section.strip() for section in final_sections if section.strip()).strip()
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
        )

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
        chain = prompt | self.llm
        try:
            async for chunk in chain.astream({"input": message}):
                content = getattr(chunk, "content", "") or ""
                if not content:
                    continue
                for event in parser.feed(str(content)):
                    yield event
        except Exception as exc:
            yield {
                "type": "output",
                "agent": agent_name,
                "label": label,
                "content": f"本轮{label}暂时无法完整生成。我先给出最小建议：围绕当前问题补充依据、明确判断标准，并把下一步分工写入协作文档。",
                "error": str(exc),
            }
        for event in parser.flush():
            yield event

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
项目任务说明：{self._clip_context(context.get("project_task_context"), 900)}
阶段滚动记忆：{self._clip_context(context.get("stage_memory_context"), 700)}
小组同伴讨论记忆：{self._clip_context(context.get("group_peer_context") or context.get("group_chat_context"), 700)}
小组 AI 互动记忆：{self._clip_context(context.get("group_ai_context"), 420)}
检索材料：{self._clip_context(context.get("rag_context"), 1600)}
前序智能体输出：{self._clip_context(previous_text, 1000)}

输出要求：
- 先用 <think>...</think> 包裹一条 20-50 字的“处理摘要”，只说明你将从哪个角度支持学习者；不要展示详细推理链。
- 正式回答必须使用中文，默认 120-220 字。
- 回答要包含：当前需要处理的判断点、一个具体下一步行动、一个可继续讨论的问题。
- 不替学习者完成最终答案，不暴露实验条件、graph_version、规则 ID 或内部路由细节。
"""

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
        return {
            "primary_agent": primary_agent,
            "primary_view": primary_agent,
            "rationale_summary": (
                f"本轮主要围绕“{plan.get('knowledge_construct_label')}”和"
                f"“{plan.get('regulation_construct_label')}”提供协作支架。"
            ),
            "routing_summary": [
                f"主要视角：{primary_agent}",
                f"支架需要：{plan.get('support_need')}",
                f"检索策略：{rag_plan.get('retrieval_mode')}",
            ],
            "processing_summary": [
                f"识别当前过程：{plan.get('knowledge_construct_label')}",
                f"选择支持方式：{self._mode_label(plan.get('orchestration_mode'))}",
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
                        "session_id": session_id,
                        "message_length": len(message or ""),
                    },
                }
            ],
            current_user_id=context.get("user_id"),
        )

agent_service = AgentService()
