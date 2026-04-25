"""AI service for chat and conversation management."""


from dataclasses import dataclass
import re
from typing import AsyncIterator, List, Optional
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

import tiktoken
from app.core.llm_config import get_llm, get_llm_for_role
from app.repositories.ai_conversation import AIConversation
from app.repositories.ai_message import AIMessage as AIMessageModel
from app.repositories.ai_role import AIRole


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
    MAX_CONTEXT_TOKENS = 8000  # Maximum context tokens
    MAX_RESPONSE_TOKENS = 2000  # Maximum response tokens
    TOKEN_BUDGET_PER_USER = 100000  # Daily token budget per user

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
            ),
        ),
        "default-tutor": FallbackAIRole(
            id="builtin:default-tutor",
            name="过程导师",
            temperature=0.7,
            system_prompt=(
                "你是一名过程导师。你的职责是帮助学习者澄清阶段任务、推进协作过程、补充判断依据、"
                "比较不同观点并促进修订。请优先用中文给出分步建议、追问和改进方向，避免空泛鼓励。"
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
    async def generate_followup_suggestions(message: str) -> List[str]:
        """Generate 3 follow-up questions based on the AI response."""
        try:
            llm = await get_llm(temperature=0.7)
            prompt = f"""请基于下面这段 AI 回复，生成 3 个适合学生继续追问的中文问题，帮助其深化理解。
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
            context_text = "\n\nContext:\n" + str(context)
            messages[-1] = HumanMessage(content=message + context_text)

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
            context_text = "\n\nContext:\n" + str(context)
            messages[-1] = HumanMessage(content=message + context_text)

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


ai_service = AIService()
