"""AI service for chat and conversation management."""


from dataclasses import dataclass
from datetime import datetime
import re
from typing import AsyncIterator, List, Optional
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

import tiktoken
from app.core.llm_config import get_llm, get_llm_for_role
from app.repositories.ai_conversation import AIConversation
from app.repositories.ai_message import AIMessage as AIMessageModel
from app.repositories.ai_role import AIRole


AISCL_PLATFORM_GUIDE = (
    "AISCL 平台功能速查：协作文档用于共同撰写和沉淀结论；论证空间用于结构化观点、证据、反驳和关系；"
    "小组资料用于上传课程资源、学习资料、图片和成果材料；知识沉淀用于形成任务简报、概念卡、证据卡、观点卡、争议卡和阶段结论；"
    "AI 对话适合个人深入追问，小组聊天 @AISCL智能助手 适合公开协作支架；学习概览查看 4C 和过程建议；"
    "教师支持用于低频向教师求助；任务清单用于分解小组待办，教师发布的限时任务需要上传成果并提交。"
    "只有当上下文提供实际检索结果或引用来源时，才建议查看资源库或 Wiki 中的现有内容；"
    "如果没有检索结果，不要假设资源库/Wiki 已有内容可查，应建议先上传资料、创建 Wiki 卡片或补充材料线索。"
)

PEDAGOGICAL_RESPONSE_CONTRACT = (
    "AISCL 回答契约：回答先识别线上小组对话处境，再给支架；推荐顺序是"
    "“识别处境 -> 平等协作式回应 -> 追问关键缺口 -> 下一步支架 -> 促进同伴互助”。"
    "四阶段支架矩阵：问题构建重在澄清任务、界定问题、识别分歧；意义探索重在扩展资料、比较观点、判断证据质量；"
    "解释整合重在组织证据链、形成解释、处理反驳；应用解决重在落地方案、检验适用边界、修订成果。"
    "情绪与动机协调是横切要求：当成员焦虑、没动力、沉默、冲突、怕做错或觉得太难时，"
    "先承认困难并把任务切小，再给一个 10 分钟内可完成的动作和一个同伴互助建议。"
    "不要用课堂教师或裁判口吻，不要用空泛鼓励替代支架，不要责备成员，不要替小组完成最终判断。"
)


@dataclass
class FallbackAIRole:
    """Minimal in-memory AI role used when the database has no AIRole documents."""

    id: str
    name: str
    system_prompt: str
    temperature: float = 0.7
    is_default: bool = False


class AIService:
    """Service for AI chat and conversation."""

    # Token budget configuration
    MAX_CONTEXT_TOKENS = 12000  # Maximum context tokens
    MAX_RESPONSE_TOKENS = 3500  # Maximum response tokens
    TOKEN_BUDGET_PER_USER = 100000  # Daily token budget per user

    @staticmethod
    def _direct_conversation_title(message: str) -> str:
        title = " ".join((message or "").split())
        if not title:
            return "新对话"
        return title[:32] + ("..." if len(title) > 32 else "")

    @staticmethod
    def _coerce_raw_context_messages(context_messages: Optional[List[dict]]) -> List[HumanMessage | AIMessage]:
        messages: List[HumanMessage | AIMessage] = []
        for item in context_messages or []:
            if not isinstance(item, dict):
                continue
            content = str(item.get("content") or "").strip()
            if not content:
                continue
            role = str(item.get("role") or "user").strip().lower()
            messages.append(AIMessage(content=content) if role == "assistant" else HumanMessage(content=content))
        return messages

    FALLBACK_ROLES = {
        "default": FallbackAIRole(
            id="builtin:default",
            name="AISCL智能助手",
            is_default=True,
            temperature=0.7,
            system_prompt=(
                "你是 AISCL 的智能学习助手。你的目标是支持学习者在人智协同学习中推进问题理解、"
                "证据比较、观点修订和协作记录。请优先使用中文，保持回答简洁、具体、可操作。"
                "不要直接替学习者完成判断，应通过提问、提示和结构化建议推动其继续思考。"
                "当学习者询问平台操作时，请根据 AISCL 平台功能直接给出操作路径和下一步。"
                f"{PEDAGOGICAL_RESPONSE_CONTRACT}"
                f"{AISCL_PLATFORM_GUIDE}"
            ),
        ),
        "default-tutor": FallbackAIRole(
            id="builtin:default-tutor",
            name="过程导师",
            temperature=0.7,
            system_prompt=(
                "你是一名过程导师。你的职责是帮助学习者澄清阶段任务、推进协作过程、补充判断依据、"
                "比较不同观点并促进修订。请优先用中文给出分步建议、追问和改进方向，避免空泛鼓励。"
                "当问题属于平台操作或功能使用，请优先说明应进入哪个页签、点击哪个入口、如何记录或提交。"
                f"{PEDAGOGICAL_RESPONSE_CONTRACT}"
                f"{AISCL_PLATFORM_GUIDE}"
            ),
        ),
    }

    THINK_BLOCK_PATTERN = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)

    @staticmethod
    def estimate_tokens(text: str) -> int:
        """Estimate token count using tiktoken."""
        try:
            encoding = tiktoken.encoding_for_model("gpt-4")
            return len(encoding.encode(text))
        except Exception:
            # Fallback: rough estimate (1 token ≈ 4 characters)
            return len(text) // 4

    @staticmethod
    def sanitize_model_output(text: str) -> str:
        """Remove provider-specific reasoning wrappers from model output."""
        if not text:
            return text
        cleaned = AIService.THINK_BLOCK_PATTERN.sub("", text)
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
        return cleaned.strip()

    @staticmethod
    def format_context_for_prompt(context: Optional[dict]) -> str:
        """Format RAG and short-term group memory for model input."""
        if not context:
            return ""

        sections: list[str] = []
        project_task_context = context.get("project_task_context")
        if project_task_context:
            sections.append(f"当前项目任务说明：\n{project_task_context}")

        stage_memory_context = context.get("stage_memory_context")
        if stage_memory_context:
            sections.append(f"当前阶段滚动记忆：\n{stage_memory_context}")

        group_state_context = context.get("group_state_context")
        if group_state_context:
            sections.append(f"小组当前状态记忆：\n{group_state_context}")

        group_peer_context = context.get("group_peer_context")
        if group_peer_context:
            sections.append(f"小组协作讨论记忆：\n{group_peer_context}")

        group_ai_context = context.get("group_ai_context")
        if group_ai_context:
            sections.append(f"小组 AI 互动记忆：\n{group_ai_context}")

        group_chat_context = context.get("group_chat_context")
        if group_chat_context and not group_peer_context and not group_ai_context:
            sections.append(f"小组最近对话上下文：\n{group_chat_context}")

        citations = context.get("citations")
        has_web_citation = any(
            (citation.get("resource_type") or citation.get("source_type")) == "web"
            for citation in citations or []
            if isinstance(citation, dict)
        )

        rag_content = context.get("content")
        if rag_content:
            label = "联网搜索兜底结果" if has_web_citation else "项目资料/ Wiki 检索结果"
            sections.append(f"{label}：\n{rag_content}")

        if citations:
            sections.append(f"可引用来源：\n{citations}")
        if not rag_content and not citations:
            sections.append(
                "资料/Wiki可用性：本轮没有检索到项目资料或 Wiki 引用。"
                "不要暗示资源库/Wiki 已有内容可搜索；如需证据支持，应建议先上传资料、创建 Wiki 卡片或补充选中文本。"
            )

        extra_context = {
            key: value
            for key, value in context.items()
            if key not in {
                "group_chat_context",
                "group_peer_context",
                "group_ai_context",
                "group_memory_message_count",
                "group_peer_message_count",
                "group_ai_interaction_count",
                "group_state_context",
                "group_state_updated_at",
                "group_state_memory_id",
                "group_state_memory_version",
                "stage_memory_context",
                "stage_memory_updated_at",
                "stage_memory_id",
                "stage_memory_version",
                "project_task_context",
                "content",
                "citations",
            }
            and value
        }
        if extra_context:
            sections.append(f"其他上下文：\n{extra_context}")

        return "\n\n".join(sections)

    @staticmethod
    def truncate_context(messages: List, max_tokens: int) -> List:
        """Truncate context to fit within token budget."""
        total_tokens = sum(
            AIService.estimate_tokens(str(msg.content)) for msg in messages
        )

        if total_tokens <= max_tokens:
            return messages

        # Remove oldest messages first (except system message)
        truncated = [messages[0]]  # Keep system message
        remaining_tokens = max_tokens - AIService.estimate_tokens(str(messages[0].content))

        for msg in reversed(messages[1:]):
            msg_tokens = AIService.estimate_tokens(str(msg.content))
            if msg_tokens <= remaining_tokens:
                truncated.insert(1, msg)
                remaining_tokens -= msg_tokens
            else:
                break

        return truncated

    @staticmethod
    def truncate_raw_messages(messages: List, max_tokens: int) -> List:
        """Truncate direct LLM messages without assuming a system prompt exists."""
        total_tokens = sum(
            AIService.estimate_tokens(str(msg.content)) for msg in messages
        )
        if total_tokens <= max_tokens:
            return messages

        truncated: list = []
        remaining_tokens = max_tokens
        for msg in reversed(messages):
            msg_tokens = AIService.estimate_tokens(str(msg.content))
            if msg_tokens <= remaining_tokens:
                truncated.insert(0, msg)
                remaining_tokens -= msg_tokens
            elif not truncated:
                truncated.insert(0, msg)
                break
        return truncated

    @staticmethod
    async def generate_followup_suggestions(message: str) -> List[str]:
        """Generate 3 follow-up questions based on the AI response."""
        try:
            llm = await get_llm(temperature=0.7)
            prompt = f"""请基于下面这段 AI 回复，生成 3 个适合小组成员继续追问的中文问题，帮助其深化理解。
回复内容："{message}"
输出要求：
- 必须使用中文
- 只输出 3 行
- 每行 1 个问题
- 不要编号，不要解释，不要额外文本"""
            
            response = await llm.ainvoke(prompt)
            content = AIService.sanitize_model_output(
                response.content if hasattr(response, "content") else str(response)
            )
            suggestions = [
                s.strip(" -1234567890.").strip()
                for s in content.split("\n")
                if s.strip()
            ]
            suggestions = [s for s in suggestions if "?" in s or "？" in s][:3]
            if len(suggestions) == 3:
                return suggestions
        except Exception as e:
            print(f"Suggestion Error: {e}")
        return [
            "你能再说明一下判断依据吗？",
            "还有哪些不同观点或反例值得比较？",
            "下一步我应该如何继续完善这个问题？",
        ]

    @staticmethod
    async def generate_conversation_title(message: str) -> str:
        """Generate a short title for the conversation based on the first message."""
        try:
            llm = await get_llm(temperature=0)
            prompt = f"""请根据以下用户发送的第一条对话内容，生成一个非常简短、精准的中文标题（不超过10个字）。
内容: "{message}"
注意：只返回标题文字，不要包含引号、书名号或多余的解释。"""
            
            response = await llm.ainvoke(prompt)
            title = AIService.sanitize_model_output(
                response.content if hasattr(response, "content") else str(response)
            )
            # Basic cleanup
            title = title.strip().replace('"', '').replace('“', '').replace('”', '').replace('《', '').replace('》', '')
            if len(title) > 20: # Safety truncation
                title = title[:17] + "..."
            return title
        except Exception as e:
            print(f"Title Generation Error: {e}")
            return "新对话"

    @staticmethod
    async def get_default_role() -> Optional[AIRole]:
        """Get default AI role."""
        role = await AIRole.find_one(AIRole.is_default == True)
        if not role:
            # Return first role if no default
            role = await AIRole.find_one()
        return role or AIService.FALLBACK_ROLES["default"]

    @staticmethod
    async def get_role(role_id: str) -> Optional[AIRole]:
        """Get AI role by ID."""
        if not role_id:
            return None

        builtin_aliases = {
            "default": "default",
            "builtin:default": "default",
            "default-tutor": "default-tutor",
            "builtin:default-tutor": "default-tutor",
        }
        if role_id in builtin_aliases:
            builtin_key = builtin_aliases[role_id]
            if builtin_key == "default":
                return await AIService.get_default_role()
            return AIService.FALLBACK_ROLES[builtin_key]

        try:
            return await AIRole.get(role_id)
        except Exception:
            # Handle non-ObjectId strings (e.g., "default", "default-tutor")
            return None

    @staticmethod
    def resolve_role_id(role: Optional[object], fallback_key: str = "default") -> str:
        """Resolve a persistent persona_id for DB conversations."""
        if role and getattr(role, "id", None):
            return str(getattr(role, "id"))
        return AIService.FALLBACK_ROLES[fallback_key].id

    @staticmethod
    async def chat(
        project_id: str,
        user_id: str,
        message: str,
        role_id: Optional[str] = None,
        conversation_id: Optional[str] = None,
        context: Optional[dict] = None,
        system_message_override: Optional[str] = None,
        category: str = "chat",
        message_metadata: Optional[dict] = None,
    ) -> dict:
        """Non-streaming chat with AI.

        Args:
            project_id: Project ID
            user_id: User ID
            message: User message
            role_id: Optional AI role ID
            conversation_id: Optional conversation ID (for continuing conversation)
            context: Optional context (e.g., RAG results)
            system_message_override: Optional system prompt override

        Returns:
            Response dict with message and conversation_id
        """
        # Get or create conversation
        if conversation_id:
            conversation = await AIConversation.get(conversation_id)
            if not conversation:
                raise ValueError("Conversation not found")
        else:
            # Get AI role
            fallback_key = "default-tutor" if role_id == "default-tutor" else "default"
            if role_id:
                role = await AIService.get_role(role_id)
            else:
                role = await AIService.get_default_role()

            # Create new conversation
            conversation = AIConversation(
                project_id=project_id,
                user_id=user_id,
                persona_id=AIService.resolve_role_id(role, fallback_key=fallback_key),
                category=category,
            )
            await conversation.insert()

        # Get role
        # Fix: handle role aliases correctly
        role_id = conversation.persona_id
        role = await AIService.get_role(role_id)
             
        if not role:
            role = await AIService.get_default_role()

        # Get conversation history
        history = await AIMessageModel.find(
            {"conversation_id": str(conversation.id)}
        ).sort("created_at").to_list()

        # Update title if this is the first real exchange
        if len(history) == 0:
            new_title = await AIService.generate_conversation_title(message)
            conversation.title = new_title
            await conversation.save()

        # Build messages
        sys_prompt = system_message_override if system_message_override else role.system_prompt
        messages = [SystemMessage(content=sys_prompt)]
        for msg in history:
            if msg.role == "user":
                messages.append(HumanMessage(content=msg.content))
            else:
                messages.append(AIMessage(content=msg.content))
        messages.append(HumanMessage(content=message))

        # Add context if provided
        if context:
            context_text = "\n\nContext:\n" + AIService.format_context_for_prompt(context)
            messages[-1] = HumanMessage(content=message + context_text)
        messages = AIService.truncate_context(messages, AIService.MAX_CONTEXT_TOKENS)

        # Get LLM
        llm = await get_llm_for_role(role.name, role.temperature)

        # Generate response
        response = await llm.ainvoke(messages)
        response_text = AIService.sanitize_model_output(
            response.content if hasattr(response, "content") else str(response)
        )

        # Save messages
        user_message = AIMessageModel(
            conversation_id=str(conversation.id),
            role="user",
            content=message,
        )
        await user_message.insert()

        ai_message = AIMessageModel(
            conversation_id=str(conversation.id),
            role="assistant",
            content=response_text,
            citations=context.get("citations", []) if context else [],
            metadata=message_metadata,
        )
        await ai_message.insert()

        # Generate dynamic suggestions
        suggestions = await AIService.generate_followup_suggestions(response_text)

        return {
            "conversation_id": str(conversation.id),
            "message": response_text,
            "citations": context.get("citations", []) if context else [],
            "suggestions": suggestions,
            "ai_meta": (message_metadata or {}).get("ai_meta") if message_metadata else None,
        }

    @staticmethod
    async def chat_stream(
        project_id: str,
        user_id: str,
        message: str,
        role_id: Optional[str] = None,
        conversation_id: Optional[str] = None,
        context: Optional[dict] = None,
        system_message_override: Optional[str] = None,
        category: str = "chat",
        message_metadata: Optional[dict] = None,
    ) -> AsyncIterator[str]:
        """Streaming chat with AI.

        Args:
            project_id: Project ID
            user_id: User ID
            message: User message
            role_id: Optional AI role ID
            conversation_id: Optional conversation ID
            context: Optional context
            system_message_override: Optional system prompt override

        Yields:
            Response chunks
        """
        # Get or create conversation
        if conversation_id:
            conversation = await AIConversation.get(conversation_id)
            if not conversation:
                raise ValueError("Conversation not found")
        else:
            fallback_key = "default-tutor" if role_id == "default-tutor" else "default"
            if role_id:
                role = await AIService.get_role(role_id)
            else:
                role = await AIService.get_default_role()

            conversation = AIConversation(
                project_id=project_id,
                user_id=user_id,
                persona_id=AIService.resolve_role_id(role, fallback_key=fallback_key),
                category=category,
            )
            await conversation.insert()

        # Get role
        role = await AIService.get_role(conversation.persona_id)
        if not role:
            role = await AIService.get_default_role()

        # Get conversation history
        history = await AIMessageModel.find(
            {"conversation_id": str(conversation.id)}
        ).sort("created_at").to_list()

        # Update title if this is the first real exchange
        if len(history) == 0:
            new_title = await AIService.generate_conversation_title(message)
            conversation.title = new_title
            await conversation.save()

        # Build messages
        sys_prompt = system_message_override if system_message_override else role.system_prompt
        messages = [SystemMessage(content=sys_prompt)]
        for msg in history:
            if msg.role == "user":
                messages.append(HumanMessage(content=msg.content))
            else:
                messages.append(AIMessage(content=msg.content))
        messages.append(HumanMessage(content=message))

        # Add context if provided
        if context:
            context_text = "\n\nContext:\n" + AIService.format_context_for_prompt(context)
            messages[-1] = HumanMessage(content=message + context_text)
        messages = AIService.truncate_context(messages, AIService.MAX_CONTEXT_TOKENS)

        # Get LLM
        llm = await get_llm_for_role(role.name, role.temperature)

        # Save user message
        user_message = AIMessageModel(
            conversation_id=str(conversation.id),
            role="user",
            content=message,
        )
        await user_message.insert()

        # Stream response
        full_response = ""
        async for chunk in llm.astream(messages):
            content = AIService.sanitize_model_output(
                chunk.content if hasattr(chunk, "content") else str(chunk)
            )
            full_response += content
            yield content

        # Save AI message
        ai_message = AIMessageModel(
            conversation_id=str(conversation.id),
            role="assistant",
            content=full_response,
            citations=context.get("citations", []) if context else [],
            metadata=message_metadata,
        )
        await ai_message.insert()

    @staticmethod
    async def raw_completion_stream(
        message: str,
        *,
        model_id: Optional[str] = None,
        temperature: float = 0.7,
        context_messages: Optional[List[dict]] = None,
    ) -> AsyncIterator[str]:
        """Direct LLM stream for control/default AI with optional neutral chat context."""
        messages = AIService._coerce_raw_context_messages(context_messages)
        messages.append(HumanMessage(content=message))
        messages = AIService.truncate_raw_messages(messages, AIService.MAX_CONTEXT_TOKENS)

        llm = await get_llm(temperature=temperature, model_id=model_id)
        async for chunk in llm.astream(messages):
            content = AIService.sanitize_model_output(
                chunk.content if hasattr(chunk, "content") else str(chunk)
            )
            if content:
                yield content

    @staticmethod
    async def raw_chat(
        project_id: str,
        user_id: str,
        message: str,
        conversation_id: Optional[str] = None,
        category: str = "chat",
        model_id: Optional[str] = None,
        context_messages: Optional[List[dict]] = None,
    ) -> dict:
        """Direct non-streaming chat: preserve conversation history but add no system prompt."""
        if conversation_id:
            conversation = await AIConversation.get(conversation_id)
            if not conversation:
                raise ValueError("Conversation not found")
        else:
            conversation = AIConversation(
                project_id=project_id,
                user_id=user_id,
                persona_id="builtin:direct-llm",
                category=category,
            )
            await conversation.insert()

        history = await AIMessageModel.find(
            {"conversation_id": str(conversation.id)}
        ).sort("created_at").to_list()

        if len(history) == 0:
            conversation.title = AIService._direct_conversation_title(message)
            await conversation.save()

        messages = AIService._coerce_raw_context_messages(context_messages)
        for msg in history:
            messages.append(HumanMessage(content=msg.content) if msg.role == "user" else AIMessage(content=msg.content))
        messages.append(HumanMessage(content=message))
        messages = AIService.truncate_raw_messages(messages, AIService.MAX_CONTEXT_TOKENS)

        llm = await get_llm(temperature=0.7, model_id=model_id)
        response = await llm.ainvoke(messages)
        response_text = AIService.sanitize_model_output(
            response.content if hasattr(response, "content") else str(response)
        )

        await AIMessageModel(
            conversation_id=str(conversation.id),
            role="user",
            content=message,
        ).insert()
        ai_message = AIMessageModel(
            conversation_id=str(conversation.id),
            role="assistant",
            content=response_text,
        )
        await ai_message.insert()
        conversation.updated_at = datetime.utcnow()
        await conversation.save()

        return {
            "conversation_id": str(conversation.id),
            "message": response_text,
            "citations": [],
            "suggestions": [],
            "ai_meta": None,
        }

    @staticmethod
    async def raw_chat_stream(
        project_id: str,
        user_id: str,
        message: str,
        conversation_id: Optional[str] = None,
        category: str = "chat",
        model_id: Optional[str] = None,
        context_messages: Optional[List[dict]] = None,
    ) -> AsyncIterator[str]:
        """Direct streaming chat: preserve history but add no role prompt, RAG, or process summary."""
        if conversation_id:
            conversation = await AIConversation.get(conversation_id)
            if not conversation:
                raise ValueError("Conversation not found")
        else:
            conversation = AIConversation(
                project_id=project_id,
                user_id=user_id,
                persona_id="builtin:direct-llm",
                category=category,
            )
            await conversation.insert()

        history = await AIMessageModel.find(
            {"conversation_id": str(conversation.id)}
        ).sort("created_at").to_list()

        if len(history) == 0:
            conversation.title = AIService._direct_conversation_title(message)
            await conversation.save()

        messages = AIService._coerce_raw_context_messages(context_messages)
        for msg in history:
            messages.append(HumanMessage(content=msg.content) if msg.role == "user" else AIMessage(content=msg.content))
        messages.append(HumanMessage(content=message))
        messages = AIService.truncate_raw_messages(messages, AIService.MAX_CONTEXT_TOKENS)

        await AIMessageModel(
            conversation_id=str(conversation.id),
            role="user",
            content=message,
        ).insert()

        llm = await get_llm(temperature=0.7, model_id=model_id)
        full_response = ""
        async for chunk in llm.astream(messages):
            content = AIService.sanitize_model_output(
                chunk.content if hasattr(chunk, "content") else str(chunk)
            )
            if not content:
                continue
            full_response += content
            yield content

        await AIMessageModel(
            conversation_id=str(conversation.id),
            role="assistant",
            content=full_response,
        ).insert()
        conversation.updated_at = datetime.utcnow()
        await conversation.save()


ai_service = AIService()
