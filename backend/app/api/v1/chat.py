"""Chat log API routes."""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.v1.auth import get_current_user
from app.core.permissions import check_project_member_permission
from app.repositories.chat_log import ChatLog
from app.repositories.project import Project
from app.repositories.user import User
from app.core.schemas.chat import ChatLogListResponse, ChatLogResponse

router = APIRouter(prefix="/chat", tags=["chat"])

SPECIAL_CHAT_SENDERS = {
    "ai_assistant": {
        "username": "AISCL智能助手",
        "avatar_url": "/avatars/ai_assistant.png",
    },
    "auto_prompt:evidence_researcher": {
        "username": "资料研究员",
        "avatar_url": "/avatars/ai_assistant.png",
    },
    "auto_prompt:viewpoint_challenger": {
        "username": "观点挑战者",
        "avatar_url": "/avatars/ai_assistant.png",
    },
    "auto_prompt:feedback_prompter": {
        "username": "反馈追问者",
        "avatar_url": "/avatars/ai_assistant.png",
    },
    "auto_prompt:problem_progressor": {
        "username": "问题推进者",
        "avatar_url": "/avatars/ai_assistant.png",
    },
}


@router.get("/projects/{project_id}/messages", response_model=ChatLogListResponse)
async def get_chat_messages(
    project_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    message_type: Optional[str] = Query(None, pattern="^(text|system|ai)$"),
    current_user: User = Depends(get_current_user),
) -> ChatLogListResponse:
    """Get chat messages for a project with pagination."""
    # Check project access
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    if not await check_project_member_permission(current_user, project):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to access this project",
        )

    # Build query
    query = {"project_id": project_id}
    if message_type:
        query["message_type"] = message_type

    # Get messages (most recent first)
    messages_cursor = (
        ChatLog.find(query).skip(skip).limit(limit).sort("-created_at")
    )
    messages_list = await messages_cursor.to_list()
    total = await ChatLog.find(query).count()

    # Get user info for messages
    user_ids = list(
        set(
            msg.user_id
            for msg in messages_list
            if msg.user_id != "system" and msg.user_id not in SPECIAL_CHAT_SENDERS
        )
    )
    users = {}
    if user_ids:
        import bson
        from app.repositories.user import User

        # Convert string IDs to ObjectIds for lookup
        object_ids = [bson.ObjectId(uid) for uid in user_ids if bson.ObjectId.is_valid(uid)]
        user_list = await User.find({"_id": {"$in": object_ids}}).to_list()
        users = {str(u.id): u for u in user_list}

    return ChatLogListResponse(
        messages=[
            ChatLogResponse(
                id=str(msg.id),
                project_id=msg.project_id,
                user_id=msg.user_id,
                username=(
                    users.get(msg.user_id).username
                    if users.get(msg.user_id)
                    else SPECIAL_CHAT_SENDERS.get(msg.user_id, {}).get("username", "System")
                ),
                avatar_url=(
                    users.get(msg.user_id).avatar_url
                    if users.get(msg.user_id)
                    else SPECIAL_CHAT_SENDERS.get(msg.user_id, {}).get("avatar_url")
                ),
                content=msg.content,
                message_type=msg.message_type,
                mentions=msg.mentions,
                client_message_id=((msg.metadata or {}).get("client_message_id") if msg.metadata else None),
                ai_meta=((msg.metadata or {}).get("ai_meta") if msg.metadata else None),
                created_at=msg.created_at,
            )
            for msg in messages_list
        ],
        total=total,
    )
