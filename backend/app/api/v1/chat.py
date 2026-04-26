"""Chat log API routes."""

from datetime import datetime
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.v1.auth import get_current_user
from app.core.permissions import check_project_member_permission
from app.repositories.chat_log import ChatLog
from app.repositories.project import Project
from app.repositories.user import User
from app.core.schemas.chat import (
    ChatLogListResponse,
    ChatLogResponse,
    TeacherSupportMessageRequest,
)
from app.services.activity_service import activity_service
from app.services.research_event_service import research_event_service
from app.websocket.socketio_server import sio

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


def build_chat_response(message: ChatLog, users: dict[str, User]) -> ChatLogResponse:
    """Build a chat API response with special sender fallback."""
    user = users.get(message.user_id)
    if user:
        username = user.username or user.email
        avatar_url = user.avatar_url
    else:
        username = SPECIAL_CHAT_SENDERS.get(message.user_id, {}).get("username", "System")
        avatar_url = SPECIAL_CHAT_SENDERS.get(message.user_id, {}).get("avatar_url")
    return ChatLogResponse(
        id=str(message.id),
        project_id=message.project_id,
        user_id=message.user_id,
        username=username,
        avatar_url=avatar_url,
        content=message.content,
        message_type=message.message_type,
        mentions=message.mentions,
        client_message_id=(
            (message.metadata or {}).get("client_message_id")
            if message.metadata
            else None
        ),
        ai_meta=((message.metadata or {}).get("ai_meta") if message.metadata else None),
        created_at=message.created_at,
    )


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
        messages=[build_chat_response(msg, users) for msg in messages_list],
        total=total,
    )


@router.post(
    "/projects/{project_id}/teacher-support",
    response_model=ChatLogResponse,
    status_code=status.HTTP_201_CREATED,
)
async def send_teacher_support_message(
    project_id: str,
    payload: TeacherSupportMessageRequest,
    current_user: User = Depends(get_current_user),
) -> ChatLogResponse:
    """Send a low-frequency teacher support message into the project group chat."""
    if current_user.role not in {"teacher", "admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only teachers and admins can send teacher support messages",
        )

    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    if not await check_project_member_permission(current_user, project):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to send support to this project",
        )

    content = payload.content.strip()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Support message content cannot be empty",
        )

    now = datetime.utcnow()
    room_id = f"project:{project_id}"
    client_message_id = f"teacher-support-{uuid.uuid4().hex}"
    metadata = {
        "client_message_id": client_message_id,
        "source": "teacher_monitor",
        "teacher_support": True,
        "support_type": payload.support_type,
    }

    chat_log = ChatLog(
        project_id=project_id,
        user_id=str(current_user.id),
        content=content,
        message_type="text",
        mentions=[],
        metadata=metadata,
        created_at=now,
    )
    await chat_log.insert()

    await activity_service.log_activity(
        project_id=project_id,
        user_id=str(current_user.id),
        module="teacher_support",
        action="send",
        metadata={
            "support_type": payload.support_type,
            "message_length": len(content),
            "room_id": room_id,
        },
    )

    experiment_version = getattr(project, "experiment_version", None) or {}
    current_stage = experiment_version.get("current_stage")
    experiment_version_id = (
        experiment_version.get("version_name")
        or experiment_version.get("name")
        or experiment_version.get("template_release_id")
    )

    await research_event_service.record_batch_events(
        events=[
            {
                "project_id": project_id,
                "experiment_version_id": experiment_version_id,
                "room_id": room_id,
                "group_id": room_id,
                "user_id": str(current_user.id),
                "actor_type": "teacher",
                "event_domain": "dialogue",
                "event_type": "teacher_support_send",
                "stage_id": current_stage,
                "payload": {
                    "support_type": payload.support_type,
                    "message_length": len(content),
                    "source": "teacher_monitor",
                    "client_message_id": client_message_id,
                },
            }
        ],
        current_user_id=str(current_user.id),
    )

    await sio.emit(
        "operation",
        {
            "id": client_message_id,
            "module": "chat",
            "roomId": room_id,
            "timestamp": int(now.timestamp() * 1000),
            "clientId": str(current_user.id),
            "version": 0,
            "type": "message",
            "data": {
                "messageId": client_message_id,
                "clientMessageId": client_message_id,
                "content": content,
                "mentions": [],
                "sender": {
                    "id": str(current_user.id),
                    "username": current_user.username or current_user.email,
                    "avatar": current_user.avatar_url,
                },
                "teacherSupport": {
                    "supportType": payload.support_type,
                    "source": "teacher_monitor",
                },
            },
        },
        room=room_id,
    )

    return build_chat_response(chat_log, {str(current_user.id): current_user})
