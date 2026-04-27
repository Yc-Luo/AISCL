"""AI conversation and intervention API routes."""

import json
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse

from app.api.v1.auth import get_current_user
from app.core.security import limiter
from app.core.permissions import can_manage_project_scope, check_project_member_permission
from app.repositories.ai_conversation import AIConversation
from app.repositories.ai_intervention_rule import AIInterventionRule
from app.repositories.ai_role import AIRole
from app.repositories.project import Project
from app.repositories.user import User
from app.core.schemas.ai import (
    AIChatRequest,
    AIChatResponse,
    AIContextActionRequest,
    AIConversationListResponse,
    AIConversationResponse,
    AIMessageListResponse,
    AIMessageResponse,
    AIRoleListResponse,
    AIRoleResponse,
    InterventionCheckRequest,
    InterventionCheckResult,
    InterventionRuleCreateRequest,
    InterventionRuleResponse,
    InterventionRuleUpdateRequest,
)
from app.repositories.ai_message import AIMessage
from app.services.ai_service import ai_service
from app.services.intervention_service import intervention_service
from app.services.rag_service import rag_service
from app.services.agents.agent_service import agent_service

router = APIRouter(prefix="/ai", tags=["ai"])

SUBAGENT_VIEW_LABELS: Dict[str, str] = {
    "evidence_researcher": "资料研究员",
    "viewpoint_challenger": "观点挑战者",
    "feedback_prompter": "反馈追问者",
    "problem_progressor": "问题推进者",
}


def _sse_event(event: str, data: dict | str) -> dict:
    """Build a structured SSE event while keeping non-ASCII status readable."""
    if isinstance(data, str):
        payload = data
    else:
        payload = json.dumps(data, ensure_ascii=False)
    return {"event": event, "data": payload}


async def ensure_project_access(current_user: User, project: Project) -> None:
    """Ensure current user can access a project-scoped AI endpoint."""
    if not await check_project_member_permission(current_user, project):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to access this project",
        )


async def ensure_project_staff_access(current_user: User, project: Project, detail: str) -> None:
    """Ensure current user can manage project-level AI settings or exports."""
    if not await can_manage_project_scope(current_user, project):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
        )


def _infer_tutor_subagent_from_message(
    message: Optional[str],
    current_stage: Optional[str],
) -> str:
    text = (message or "").strip()
    score_map: Dict[str, int] = {
        "evidence_researcher": 0,
        "viewpoint_challenger": 0,
        "feedback_prompter": 0,
        "problem_progressor": 0,
    }
    weighted_patterns = [
        ("viewpoint_challenger", r"反驳|质疑|不同意见|替代方案|反方|反例|漏洞|站不住脚|局限|偏见|争议|挑战|对立观点|另一种解释", 3),
        ("feedback_prompter", r"修改|优化|改进|完善|修订|修正|调整|反馈|评价标准|标准|不足|薄弱|怎么改|如何改进|如何完善|如何修正|证据够吗|充分吗", 3),
        ("problem_progressor", r"下一步|推进|计划|步骤|先做什么|怎么开始|如何开展|如何推进|任务|分工|安排|进展|卡住|梳理|路线|流程", 3),
        ("evidence_researcher", r"资料|证据|出处|来源|文献|背景|概念|什么是|材料|案例|信息|查找|搜集|搜索|依据|数据", 3),
        ("feedback_prompter", r"学习重点|收获|哪里需要注意|怎么提升|如何提高", 2),
        ("problem_progressor", r"目前进展|现在到哪一步|当前情况|整体情况", 2),
        ("evidence_researcher", r"帮我解释|帮我说明|了解一下|背景知识", 2),
    ]

    for subagent, pattern, weight in weighted_patterns:
        import re

        matches = re.findall(pattern, text)
        if matches:
            score_map[subagent] += len(matches) * weight

    best_subagent = max(score_map, key=score_map.get)
    if score_map[best_subagent] > 0:
        return best_subagent

    stage = current_stage or ""
    if any(keyword in stage for keyword in ["argumentation", "论证", "协商"]):
        return "viewpoint_challenger"
    if any(keyword in stage for keyword in ["revision", "reflection", "修订", "反思"]):
        return "feedback_prompter"
    if any(keyword in stage for keyword in ["inquiry", "evidence", "证据", "探究"]):
        return "evidence_researcher"
    return "problem_progressor"


def _resolve_tutor_primary_view(
    preferred_subagent: Optional[str],
    role_id: Optional[str],
    message: Optional[str],
    current_stage: Optional[str],
) -> str:
    if preferred_subagent and preferred_subagent in SUBAGENT_VIEW_LABELS:
        return SUBAGENT_VIEW_LABELS[preferred_subagent]
    inferred_subagent = _infer_tutor_subagent_from_message(message, current_stage)
    if inferred_subagent in SUBAGENT_VIEW_LABELS:
        return SUBAGENT_VIEW_LABELS[inferred_subagent]
    if role_id == "default-tutor":
        return "问题推进者"
    return "资料研究员"


def _build_tutor_ai_meta(chat_data: AIChatRequest) -> dict:
    primary_view = _resolve_tutor_primary_view(
        chat_data.preferred_subagent,
        chat_data.role_id,
        chat_data.message,
        chat_data.current_stage,
    )
    rationale_summary = (
        f"结合当前阶段与提问内容，本轮 AI 导师主要采用“{primary_view}”的支架视角。"
        if chat_data.current_stage
        else f"结合当前提问内容，本轮 AI 导师主要采用“{primary_view}”的支架视角。"
    )
    processing_summary = [
        f"正在识别当前阶段目标：{chat_data.current_stage or '未设置阶段'}",
        f"正在调用 {primary_view} 组织本轮支架回应",
    ]
    if chat_data.enabled_rule_set:
        processing_summary.append(
            f"正在结合规则集 {chat_data.enabled_rule_set} 调整回应重点"
        )
    processing_summary.append("正在生成面向当前任务的下一步建议")
    return {
        "primary_view": primary_view,
        "rationale_summary": rationale_summary,
        "processing_summary": processing_summary,
    }


@router.post("/chat", response_model=AIChatResponse)
@limiter.limit("30/minute")
async def chat(
    chat_data: AIChatRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
) -> AIChatResponse:
    """Non-streaming AI chat."""
    # Check project access
    project = await Project.get(chat_data.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_access(current_user, project)

    # Retrieve context using RAG if enabled
    context = None
    if chat_data.use_rag:
        try:
            context = await rag_service.retrieve_context(
                chat_data.project_id,
                chat_data.message,
                user_id=str(current_user.id),
                actor_type="ai_tutor" if chat_data.role_id == "default-tutor" else "system",
                stage_id=chat_data.current_stage,
                experiment_version_id=(
                    (project.experiment_version or {}).get("version_name")
                    if getattr(project, "experiment_version", None)
                    else None
                ),
            )
        except Exception as e:
            print(f"RAG Error: {e}")
            context = None

    # Chat with AI
    response = await ai_service.chat(
        project_id=chat_data.project_id,
        user_id=str(current_user.id),
        message=chat_data.message,
        role_id=chat_data.role_id,
        conversation_id=chat_data.conversation_id,
        context=context,
        message_metadata=(
            {"ai_meta": _build_tutor_ai_meta(chat_data)}
            if chat_data.role_id == "default-tutor"
            else None
        ),
    )

    return AIChatResponse(
        conversation_id=response["conversation_id"],
        message=response["message"],
        citations=response.get("citations", []),
        suggestions=response.get("suggestions", []),
        ai_meta=response.get("ai_meta"),
    )


@router.post("/action", response_model=AIChatResponse)
@limiter.limit("20/minute")
async def ai_action(
    action_data: AIContextActionRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
) -> AIChatResponse:
    """Specialized AI context-aware actions."""
    # Check project access
    project = await Project.get(action_data.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_access(current_user, project)

    # Define specialized prompts based on action type
    prompts = {
        "summarize": f"请对以下{action_data.context_type}的内容进行结构化总结。请使用 Markdown 标题、分点列表或表格形式，确保逻辑清晰、重点突出：\n\n",
        "knowledge_graph": f"请针对以下{action_data.context_type}的内容，提取核心概念并梳理其关联。请使用 Markdown 层级列表或 Mermaid 语法（graph TD）来展示知识图谱，并附带简要的概念说明：\n\n",
        "optimize": f"请分析以下{action_data.context_type}的内容并给出专业建议。请采用『现状分析』、『改进建议』、『预期效果』三个板块进行展示，使用 Markdown 格式确保可读性：\n\n",
        "devil_advocate": f"请作为“恶魔代言人 (Devil's Advocate)”，审视以下论证结构。请识别逻辑谬误、证据薄弱环节，并提出至少 3 个尖锐的反驳观点。请直接以 Markdown 列表形式输出建议：\n\n",
        "inquiry_clustering": f"请分析以下探究内容中的核心概念，并将其归类为 3-4 个逻辑模块。请使用 Markdown 形式展示每个模块的名称及其包含的要点，帮助我理清思路：\n\n",
    }
    
    system_prompt = (
        "你是一个极其专业的协作学习助理。你擅长将杂乱的信息转化为结构清晰、视觉友好的 Markdown 文档。\n"
        "回答原则：\n"
        "1. 严禁输出大段不换行的文字。\n"
        "2. 必须使用 Markdown 标题（# ## ###）来区分模块。\n"
        "3. 核心结论请使用加粗（**关键词**）。\n"
        "4. 合理使用引用块（>）或代码块来突出重点。\n"
        "5. 如果内容包含步骤或多个要点，请使用有序或无序列表。"
    )
    user_message = f"{prompts.get(action_data.action_type, '')}{action_data.content}"
    if action_data.additional_query:
        user_message += f"\n\n用户特别要求：{action_data.additional_query}"

    # Use ai_service to perform the chat
    # We pass use_rag=False because the context is already provided explicitly in the content
    response = await ai_service.chat(
        project_id=action_data.project_id,
        user_id=str(current_user.id),
        message=user_message,
        role_id=None, # Use default role
        conversation_id=None, # New session for each action usually
        system_message_override=system_prompt,
        category="action",
    )

    return AIChatResponse(
        conversation_id=response["conversation_id"],
        message=response["message"],
        suggestions=[],
    )


@router.post("/chat/stream")
@limiter.limit("20/minute")
async def chat_stream(
    chat_data: AIChatRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """Streaming AI chat (SSE)."""
    # Check project access
    project = await Project.get(chat_data.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_access(current_user, project)

    conversation: Optional[AIConversation] = None
    if chat_data.conversation_id:
        conversation = await AIConversation.get(chat_data.conversation_id)
        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found",
            )
    else:
        fallback_key = "default-tutor" if chat_data.role_id == "default-tutor" else "default"
        role = await ai_service.get_role(chat_data.role_id) if chat_data.role_id else await ai_service.get_default_role()
        if not role:
            role = await ai_service.get_default_role()
        conversation = AIConversation(
            project_id=chat_data.project_id,
            user_id=str(current_user.id),
            persona_id=ai_service.resolve_role_id(role, fallback_key=fallback_key),
            category="chat",
        )
        await conversation.insert()

    existing_message_count = await AIMessage.find({"conversation_id": str(conversation.id)}).count()
    should_generate_title = existing_message_count == 0 and bool(chat_data.message)

    async def generate():
        async def refresh_conversation_title_if_needed() -> None:
            if not should_generate_title or not chat_data.message:
                return
            try:
                conversation.title = await ai_service.generate_conversation_title(chat_data.message)
            except Exception as exc:
                print(f"Conversation title generation skipped: {exc}")

        yield _sse_event(
            "status",
            {
                "step": "received",
                "message": "已收到问题，正在准备 AI 导师回应。",
            },
        )

        tutor_meta = _build_tutor_ai_meta(chat_data)
        yield _sse_event("meta", {"ai_meta": tutor_meta})

        # Retrieve context inside the SSE generator so the client receives
        # progress feedback during potentially slow RAG calls.
        context = None
        if chat_data.use_rag:
            yield _sse_event(
                "status",
                {
                    "step": "retrieval",
                    "message": "正在检索项目 Wiki、资源库和近期协作记录。",
                },
            )
            try:
                context = await rag_service.retrieve_context(
                    chat_data.project_id,
                    chat_data.message,
                    user_id=str(current_user.id),
                    actor_type="ai_tutor" if chat_data.role_id == "default-tutor" else "system",
                    stage_id=chat_data.current_stage,
                    experiment_version_id=(
                        (project.experiment_version or {}).get("version_name")
                        if getattr(project, "experiment_version", None)
                        else None
                    ),
                )
                yield _sse_event(
                    "status",
                    {
                        "step": "retrieval_done",
                        "message": "检索完成，正在组织可引用的学习支持回应。",
                        "citation_count": len(context.get("citations", [])) if context else 0,
                    },
                )
            except Exception as e:
                print(f"RAG Error: {e}")
                context = None
                yield _sse_event(
                    "status",
                    {
                        "step": "retrieval_skipped",
                        "message": "项目资料检索暂不可用，正在基于当前问题直接回应。",
                    },
                )

        # Construct context string if RAG is enabled
        final_message = chat_data.message
        if context:
            final_message = f"Context:\n{context['content']}\n\nUser Question: {chat_data.message}"
        
        full_response = ""
        try:
            experiment_version = (
                project.experiment_version or {}
                if getattr(project, "experiment_version", None)
                else {}
            )
            if experiment_version.get("ai_scaffold_mode") == "single_agent":
                yield _sse_event(
                    "status",
                    {
                        "step": "generating",
                        "message": "已进入单 AI 回答模式，正在生成最终回答。",
                    },
                )
                async for chunk in ai_service.chat_stream(
                    project_id=chat_data.project_id,
                    user_id=str(current_user.id),
                    message=chat_data.message or "",
                    role_id=chat_data.role_id,
                    conversation_id=str(conversation.id),
                    context=context,
                    category="chat",
                    message_metadata=(
                        {"ai_meta": tutor_meta}
                        if chat_data.role_id == "default-tutor"
                        else None
                    ),
                ):
                    full_response += chunk
                    yield _sse_event("delta", chunk)

                conversation.updated_at = datetime.utcnow()
                await refresh_conversation_title_if_needed()
                await conversation.save()
                yield _sse_event(
                    "done",
                    {
                        "conversation_id": str(conversation.id),
                        "citation_count": len(context.get("citations", [])) if context else 0,
                    },
                )
                return

            # Multi-agent mode uses graph routing. The Supervisor handles intent
            # and delegates to the constrained research sub-agent when needed.
            primary_view = tutor_meta.get("primary_view") or "AI 导师"
            yield _sse_event(
                "status",
                {
                    "step": "routing",
                    "message": f"正在进行多智能体编排，本轮主要视角：{primary_view}。",
                    "primary_view": primary_view,
                },
            )
            graph_context = {
                "project_id": chat_data.project_id,
                "experiment_version_id": (
                    experiment_version.get("version_name")
                    if experiment_version
                    else None
                ),
                "current_stage": chat_data.current_stage,
                "enabled_rule_set": chat_data.enabled_rule_set,
                "enabled_scaffold_roles": chat_data.enabled_scaffold_roles,
                "preferred_subagent": chat_data.preferred_subagent,
                "source_actor_type": "system",
                "user_id": str(current_user.id),
            }

            user_message = AIMessage(
                conversation_id=str(conversation.id),
                role="user",
                content=chat_data.message or "",
            )
            await user_message.insert()

            yield _sse_event(
                "status",
                {
                    "step": "generating",
                    "message": "已完成角色选择，正在生成最终回答。",
                },
            )
            async for chunk in agent_service.chat_stream(
                persona_key=chat_data.role_id, # Passed but currently ignored by Supervisor logic
                message=final_message,
                session_id=str(conversation.id),
                subject="General", # Could be retrieved from Project domain
                context=graph_context,
            ):
                full_response += chunk
                yield _sse_event("delta", chunk)

            ai_message = AIMessage(
                conversation_id=str(conversation.id),
                role="assistant",
                content=ai_service.sanitize_model_output(full_response.strip()),
                citations=context.get("citations", []) if context else [],
                metadata=(
                    {"ai_meta": tutor_meta}
                    if chat_data.role_id == "default-tutor"
                    else None
                ),
            )
            await ai_message.insert()
            conversation.updated_at = datetime.utcnow()
            await refresh_conversation_title_if_needed()
            await conversation.save()
            yield _sse_event(
                "done",
                {
                    "conversation_id": str(conversation.id),
                    "message_id": str(ai_message.id),
                    "citation_count": len(context.get("citations", [])) if context else 0,
                },
            )
        except Exception as e:
            # Fallback for debugging, yield nothing or error
            print(f"Agent Service Error: {e}")
            yield _sse_event(
                "error",
                {
                    "message": "AI 服务处理失败，请稍后重试。",
                    "detail": str(e),
                },
            )
            yield _sse_event("delta", f"[System Error]: {str(e)}")

    return EventSourceResponse(generate())


@router.get("/conversations/{project_id}", response_model=AIConversationListResponse)
async def get_conversations(
    project_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
) -> AIConversationListResponse:
    """Get AI conversations for a project."""
    # Check project access
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_access(current_user, project)

    can_view_all_conversations = await can_manage_project_scope(current_user, project)

    # Get conversations
    # Filter: Only show conversations that have at least one message
    # We use an aggregation pipeline to filter conversations by existence of messages
    match_query = {"project_id": project_id, "category": "chat"}
    if not can_view_all_conversations:
        match_query["user_id"] = str(current_user.id)

    pipeline = [
        {"$match": match_query},
        {"$addFields": {"id_str": {"$toString": "$_id"}}},
        {
            "$lookup": {
                "from": "ai_messages",
                "localField": "id_str",
                "foreignField": "conversation_id",
                "as": "messages",
            }
        },
        {"$match": {"messages": {"$not": {"$size": 0}}}},
        {"$sort": {"updated_at": -1}},
        {"$skip": skip},
        {"$limit": limit},
    ]

    conversations_cursor = AIConversation.aggregate(pipeline)
    conversations = await conversations_cursor.to_list()

    # Calculate total for pagination (also filtering out empty ones)
    count_pipeline = [
        {"$match": match_query},
        {"$addFields": {"id_str": {"$toString": "$_id"}}},
        {
            "$lookup": {
                "from": "ai_messages",
                "localField": "id_str",
                "foreignField": "conversation_id",
                "as": "messages",
            }
        },
        {"$match": {"messages": {"$not": {"$size": 0}}}},
        {"$count": "total"},
    ]
    count_result = await AIConversation.aggregate(count_pipeline).to_list()
    total = count_result[0]["total"] if count_result else 0

    return AIConversationListResponse(
        conversations=[
            AIConversationResponse(
                id=str(c["_id"]),
                project_id=c["project_id"],
                user_id=c["user_id"],
                role_id=c.get("persona_id") or "default",
                title=c.get("title", "新对话"),
                created_at=c["created_at"],
                updated_at=c["updated_at"],
            )
            for c in conversations
        ],
        total=total,
    )


@router.get("/conversations/{conversation_id}/messages", response_model=AIMessageListResponse)
async def get_messages(
    conversation_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    current_user: User = Depends(get_current_user),
) -> AIMessageListResponse:
    """Get messages for a conversation."""
    conversation = await AIConversation.get(conversation_id)
    if not conversation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    project = await Project.get(conversation.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    if str(conversation.user_id) != str(current_user.id):
        await ensure_project_staff_access(
            current_user,
            project,
            "You don't have permission to access this conversation",
        )

    messages = (
        await AIMessage.find({"conversation_id": conversation_id})
        .skip(skip)
        .limit(limit)
        .sort("created_at")
        .to_list()
    )
    total = await AIMessage.find({"conversation_id": conversation_id}).count()

    return AIMessageListResponse(
        messages=[
            AIMessageResponse(
                id=str(m.id),
                conversation_id=m.conversation_id,
                role=m.role,
                content=ai_service.sanitize_model_output(m.content),
                citations=m.citations,
                ai_meta=((m.metadata or {}).get("ai_meta") if m.metadata else None),
                created_at=m.created_at,
            )
            for m in messages
        ],
        total=total,
    )


@router.get("/roles", response_model=AIRoleListResponse)
async def get_ai_roles(
    current_user: User = Depends(get_current_user),
) -> AIRoleListResponse:
    """Get available AI roles."""
    roles = await AIRole.find().sort("is_default", -1).to_list()

    return AIRoleListResponse(
        roles=[
            AIRoleResponse(
                id=str(r.id),
                name=r.name,
                icon=r.icon,
                description=r.description,
                temperature=r.temperature,
                is_default=r.is_default,
                created_at=r.created_at,
            )
            for r in roles
        ]
    )


@router.post("/conversations", response_model=AIConversationResponse, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    conversation_data: AIChatRequest,
    current_user: User = Depends(get_current_user),
) -> AIConversationResponse:
    """Initialize a new AI conversation."""
    # Check project access
    project = await Project.get(conversation_data.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_access(current_user, project)
            
    # Check/Create conversation
    # If conversation_id is provided, verify it exists
    if conversation_data.conversation_id:
        conversation = await AIConversation.get(conversation_data.conversation_id)
        if conversation:
            return AIConversationResponse.from_orm(conversation)
            
    # Create new conversation
    # Resolve role alias to real ObjectId immediately
    persona_id = conversation_data.role_id or "default"
    role = await ai_service.get_role(persona_id)
    if not role:
        # Fallback to default if not found
        role = await ai_service.get_default_role()
    
    # Use the resolved real ID (or "default" only if DB is truly empty/broken, which schema might reject if it assumes ObjectId)
    # The AIConversation model defines persona_id as Optional[str]. We should store the real ID.
    final_persona_id = str(role.id) if role else "default"

    conversation = AIConversation(
        project_id=conversation_data.project_id,
        user_id=str(current_user.id),
        persona_id=final_persona_id,
    )
    await conversation.insert()

    return AIConversationResponse(
        id=str(conversation.id),
        project_id=conversation.project_id,
        user_id=conversation.user_id,
        role_id=final_persona_id,
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
    )


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete an AI conversation and its messages."""
    conversation = await AIConversation.get(conversation_id)
    if not conversation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )

    if str(conversation.user_id) != str(current_user.id):
        project = await Project.get(conversation.project_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found",
            )
        await ensure_project_staff_access(
            current_user,
            project,
            "You don't have permission to delete this conversation",
        )

    # Delete associated messages
    await AIMessage.find({"conversation_id": conversation_id}).delete()
    
    # Delete conversation
    await conversation.delete()


@router.get("/intervention-rules/{project_id}", response_model=List[InterventionRuleResponse])
async def get_intervention_rules(
    project_id: str,
    current_user: User = Depends(get_current_user),
) -> List[InterventionRuleResponse]:
    """Get intervention rules for a project."""
    # Check project access
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_staff_access(
        current_user,
        project,
        "Only owner, admin, and scoped teacher can view intervention rules",
    )

    # Get rules (project-specific and global)
    rules = (
        await AIInterventionRule.find(
            {
                "$or": [
                    {"project_id": project_id},
                    {"project_id": None},  # Global rules
                ]
            }
        )
        .sort("-priority")
        .to_list()
    )

    return [
        InterventionRuleResponse(
            id=str(r.id),
            project_id=r.project_id,
            rule_type=r.rule_type,
            name=r.name,
            description=r.description,
            priority=r.priority,
            enabled=r.enabled,
            silence_threshold=r.silence_threshold,
            emotion_keywords=r.emotion_keywords,
            trigger_keywords=r.trigger_keywords,
            minimum_evidence_count=r.minimum_evidence_count,
            minimum_counterargument_count=r.minimum_counterargument_count,
            revision_stall_threshold=r.revision_stall_threshold,
            max_ai_assistance_ratio=r.max_ai_assistance_ratio,
            action_type=r.action_type,
            message_template=r.message_template,
            ai_role_id=r.ai_role_id,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rules
    ]


@router.post("/intervention-rules", response_model=InterventionRuleResponse, status_code=status.HTTP_201_CREATED)
async def create_intervention_rule(
    rule_data: InterventionRuleCreateRequest,
    current_user: User = Depends(get_current_user),
) -> InterventionRuleResponse:
    """Create an intervention rule."""
    # Check project access if project_id is provided
    if rule_data.project_id:
        project = await Project.get(rule_data.project_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found",
            )

        await ensure_project_staff_access(
            current_user,
            project,
            "Only owner, admin, and scoped teacher can create intervention rules",
        )
    else:
        # Only admin can create global rules
        if current_user.role != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only admin can create global intervention rules",
            )

    # Create rule
    from datetime import datetime

    rule = AIInterventionRule(
        project_id=rule_data.project_id,
        rule_type=rule_data.rule_type,
        name=rule_data.name,
        description=rule_data.description,
        priority=rule_data.priority,
        enabled=rule_data.enabled,
        silence_threshold=rule_data.silence_threshold,
        emotion_keywords=rule_data.emotion_keywords,
        trigger_keywords=rule_data.trigger_keywords,
        minimum_evidence_count=rule_data.minimum_evidence_count,
        minimum_counterargument_count=rule_data.minimum_counterargument_count,
        revision_stall_threshold=rule_data.revision_stall_threshold,
        max_ai_assistance_ratio=rule_data.max_ai_assistance_ratio,
        action_type=rule_data.action_type,
        message_template=rule_data.message_template,
        ai_role_id=rule_data.ai_role_id,
    )
    await rule.insert()

    return InterventionRuleResponse(
        id=str(rule.id),
        project_id=rule.project_id,
        rule_type=rule.rule_type,
        name=rule.name,
        description=rule.description,
        priority=rule.priority,
        enabled=rule.enabled,
        silence_threshold=rule.silence_threshold,
        emotion_keywords=rule.emotion_keywords,
        trigger_keywords=rule.trigger_keywords,
        minimum_evidence_count=rule.minimum_evidence_count,
        minimum_counterargument_count=rule.minimum_counterargument_count,
        revision_stall_threshold=rule.revision_stall_threshold,
        max_ai_assistance_ratio=rule.max_ai_assistance_ratio,
        action_type=rule.action_type,
        message_template=rule.message_template,
        ai_role_id=rule.ai_role_id,
        created_at=rule.created_at,
        updated_at=rule.updated_at,
    )


@router.put("/intervention-rules/{rule_id}", response_model=InterventionRuleResponse)
async def update_intervention_rule(
    rule_id: str,
    rule_data: InterventionRuleUpdateRequest,
    current_user: User = Depends(get_current_user),
) -> InterventionRuleResponse:
    """Update an intervention rule."""
    rule = await AIInterventionRule.get(rule_id)
    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Intervention rule not found",
        )

    # Check permission
    if rule.project_id:
        project = await Project.get(rule.project_id)
        if project:
            await ensure_project_staff_access(
                current_user,
                project,
                "You don't have permission to update this rule",
            )
    else:
        if current_user.role != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only admin can update global rules",
            )

    # Update rule
    from datetime import datetime

    if rule_data.name:
        rule.name = rule_data.name
    if rule_data.description is not None:
        rule.description = rule_data.description
    if rule_data.priority is not None:
        rule.priority = rule_data.priority
    if rule_data.enabled is not None:
        rule.enabled = rule_data.enabled
    if rule_data.silence_threshold is not None:
        rule.silence_threshold = rule_data.silence_threshold
    if rule_data.emotion_keywords is not None:
        rule.emotion_keywords = rule_data.emotion_keywords
    if rule_data.trigger_keywords is not None:
        rule.trigger_keywords = rule_data.trigger_keywords
    if rule_data.minimum_evidence_count is not None:
        rule.minimum_evidence_count = rule_data.minimum_evidence_count
    if rule_data.minimum_counterargument_count is not None:
        rule.minimum_counterargument_count = rule_data.minimum_counterargument_count
    if rule_data.revision_stall_threshold is not None:
        rule.revision_stall_threshold = rule_data.revision_stall_threshold
    if rule_data.max_ai_assistance_ratio is not None:
        rule.max_ai_assistance_ratio = rule_data.max_ai_assistance_ratio
    if rule_data.action_type:
        rule.action_type = rule_data.action_type
    if rule_data.message_template:
        rule.message_template = rule_data.message_template
    if rule_data.ai_role_id is not None:
        rule.ai_role_id = rule_data.ai_role_id

    rule.updated_at = datetime.utcnow()
    await rule.save()

    return InterventionRuleResponse(
        id=str(rule.id),
        project_id=rule.project_id,
        rule_type=rule.rule_type,
        name=rule.name,
        description=rule.description,
        priority=rule.priority,
        enabled=rule.enabled,
        silence_threshold=rule.silence_threshold,
        emotion_keywords=rule.emotion_keywords,
        trigger_keywords=rule.trigger_keywords,
        minimum_evidence_count=rule.minimum_evidence_count,
        minimum_counterargument_count=rule.minimum_counterargument_count,
        revision_stall_threshold=rule.revision_stall_threshold,
        max_ai_assistance_ratio=rule.max_ai_assistance_ratio,
        action_type=rule.action_type,
        message_template=rule.message_template,
        ai_role_id=rule.ai_role_id,
        created_at=rule.created_at,
        updated_at=rule.updated_at,
    )


@router.delete("/intervention-rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_intervention_rule(
    rule_id: str,
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete an intervention rule."""
    rule = await AIInterventionRule.get(rule_id)
    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Intervention rule not found",
        )

    # Check permission
    if rule.project_id:
        project = await Project.get(rule.project_id)
        if project:
            await ensure_project_staff_access(
                current_user,
                project,
                "You don't have permission to delete this rule",
            )
    else:
        if current_user.role != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only admin can delete global rules",
            )

    await rule.delete()


@router.post("/interventions/check", response_model=List[InterventionCheckResult])
@limiter.limit("60/minute")
async def check_intervention_rules(
    intervention_request: InterventionCheckRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
) -> List[InterventionCheckResult]:
    """Evaluate currently applicable intervention rules for a project."""
    project = await Project.get(intervention_request.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    await ensure_project_access(current_user, project)

    interventions = await intervention_service.check_interventions(
        project_id=intervention_request.project_id,
        user_id=intervention_request.user_id or str(current_user.id),
        context=intervention_request.context.model_dump(),
        enabled_rule_set=intervention_request.enabled_rule_set,
    )

    return [
        InterventionCheckResult(
            rule_id=item["rule_id"],
            rule_name=item["rule_name"],
            rule_type=item["rule_type"],
            rule_set_applied=item.get("rule_set_applied"),
            action_type=item["action_type"],
            message=item["message"],
            ai_role_id=item.get("ai_role_id"),
            trigger_reason=item.get("trigger_reason", "unknown"),
        )
        for item in interventions
    ]
