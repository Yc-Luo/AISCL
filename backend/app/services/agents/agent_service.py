"""Agent Service using LangGraph and Deep Agents Shim."""

from typing import Dict, Any, AsyncGenerator, Optional, List

from langchain_core.messages import HumanMessage

from app.core.config import settings
from app.core.prompts.personas import PERSONAS
from app.core.llm_config import get_llm
from app.services.rag_service import rag_service
from app.services.research_event_service import research_event_service
from app.services.agents.deep_agents_shim import derive_routing_decision_from_context


class AgentService:
    """Service to manage AI Agents via LangGraph."""

    def __init__(self):
        """Initialize Graph state."""
        self.llm = None
        self.graph = None
        self._current_model_id = None

    async def initialize(self):
        """Async Initialization for the graph and LLM with hot-reload support."""
        # 1. Resolve latest model id from selected config source
        if settings.LLM_CONFIG_SOURCE.lower() == "db":
            try:
                from app.repositories.system_config import SystemConfig
                db_model = await SystemConfig.find_one(SystemConfig.key == "llm_model")
                latest_model_id = db_model.value if db_model else (
                    settings.OPENAI_MODEL if settings.LLM_PROVIDER == "openai"
                    else settings.DEEPSEEK_MODEL if settings.LLM_PROVIDER in ["deepseek", "deepseek-chat"]
                    else settings.OLLAMA_MODEL if settings.LLM_PROVIDER == "ollama"
                    else settings.OPENAI_MODEL
                )
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

        # 2. Check if we need to reload (Hot Update Logic)
        if not self.llm or self._current_model_id != latest_model_id:
            print(f"🔄 Detected model change or first init: {self._current_model_id} -> {latest_model_id}")
            self.llm = await get_llm(temperature=0.7)
            self._current_model_id = latest_model_id
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
                "selected_subagent": selected_subagent,
                "routing_decision": routing_decision,
            }

        if selected_subagent == "viewpoint_challenger":
            return {
                "should_retrieve": True,
                "max_results": 2,
                "retrieval_mode": "role_aware_targeted",
                "selected_subagent": selected_subagent,
                "routing_decision": routing_decision,
            }

        if source_actor_type == "ai_assistant" and selected_subagent in {
            "feedback_prompter",
            "problem_progressor",
        }:
            return {
                "should_retrieve": False,
                "max_results": 0,
                "retrieval_mode": "role_aware_skip",
                "selected_subagent": selected_subagent,
                "routing_decision": routing_decision,
            }

        return {
            "should_retrieve": True,
            "max_results": 3,
            "retrieval_mode": "default_full",
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
    ) -> AsyncGenerator[str, None]:
        """Stream response using the Graph."""
        
        # Initialize graph if needed (Double Check Locking Pattern in Production)
        if not self.graph:
            await self.initialize()

        # Role-aware retrieval plan: route first, then decide whether retrieval is needed.
        resolved_project_id = (
            context.get("project_id")
            if context and context.get("project_id")
            else session_id.split(":")[0]
        )
        rag_plan = self._resolve_rag_plan(context=context)
        rag_results = {"content": "", "citations": []}
        if rag_plan["should_retrieve"]:
            rag_results = await rag_service.retrieve_context(
                project_id=resolved_project_id,
                query=message,
                max_results=rag_plan["max_results"],
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

agent_service = AgentService()
