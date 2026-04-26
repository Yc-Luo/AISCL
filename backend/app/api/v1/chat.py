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
    TeacherHelpRequestCreate,
    TeacherHelpRequestListResponse,
    TeacherHelpReplyCreate,
    TeacherHelpReplyResponse,
    TeacherHelpRequestResponse,
    TeacherHelpRequestStatusUpdate,
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
    metadata = message.metadata or {}
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
        client_message_id=metadata.get("client_message_id"),
        ai_meta=metadata.get("ai_meta"),
        teacher_support=(
            {
                "support_type": metadata.get("support_type"),
                "source": metadata.get("source"),
            }
            if metadata.get("teacher_support")
            else None
        ),
        teacher_help_request=(
            {
                "help_type": metadata.get("help_type"),
                "status": metadata.get("status") or "pending",
                "source": metadata.get("source"),
                "allow_public_reply": bool(metadata.get("allow_public_reply")),
                "page_source": metadata.get("page_source"),
                "stage_id": metadata.get("stage_id"),
            }
            if metadata.get("teacher_help_request")
            else None
        ),
        file_info=metadata.get("file_info") if isinstance(metadata.get("file_info"), dict) else None,
        created_at=message.created_at,
    )


def build_help_reply_response(message: ChatLog, users: dict[str, User]) -> TeacherHelpReplyResponse:
    """Build response for a teacher reply to a help request."""
    metadata = message.metadata or {}
    user = users.get(message.user_id)
    username = user.username or user.email if user else "Unknown"
    return TeacherHelpReplyResponse(
        id=str(message.id),
        project_id=message.project_id,
        user_id=message.user_id,
        username=username,
        content=message.content,
        support_type=metadata.get("support_type"),
        public_reply=bool(metadata.get("public_reply")),
        created_at=message.created_at,
    )


def build_help_request_response(
    message: ChatLog,
    users: dict[str, User],
    replies: Optional[list[TeacherHelpReplyResponse]] = None,
) -> TeacherHelpRequestResponse:
    """Build teacher monitor response for a student help request."""
    metadata = message.metadata or {}
    user = users.get(message.user_id)
    username = user.username or user.email if user else "Unknown"
    return TeacherHelpRequestResponse(
        id=str(message.id),
        project_id=message.project_id,
        user_id=message.user_id,
        username=username,
        content=message.content,
        help_type=metadata.get("help_type"),
        allow_public_reply=bool(metadata.get("allow_public_reply")),
        stage_id=metadata.get("stage_id"),
        page_source=metadata.get("page_source"),
        status=metadata.get("status") or "pending",
        created_at=message.created_at,
        replies=replies or [],
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
    query = {
        "project_id": project_id,
        "metadata.teacher_help_request": {"$ne": True},
        "metadata.teacher_private_reply": {"$ne": True},
    }
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


@router.get(
    "/projects/{project_id}/teacher-help-requests",
    response_model=TeacherHelpRequestListResponse,
)
async def get_teacher_help_requests(
    project_id: str,
    status_filter: Optional[str] = Query(None, alias="status", pattern="^(pending|replied|resolved)$"),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
) -> TeacherHelpRequestListResponse:
    """List student help requests for the teacher monitor panel."""
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    if not await check_project_member_permission(current_user, project):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to view help requests for this project",
        )

    query = {
        "project_id": project_id,
        "metadata.teacher_help_request": True,
    }
    if current_user.role == "student":
        query["user_id"] = str(current_user.id)
    elif current_user.role not in {"teacher", "admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only students, teachers, and admins can view teacher help requests",
        )
    if status_filter:
        query["metadata.status"] = status_filter

    requests = (
        await ChatLog.find(query)
        .sort("-created_at")
        .limit(limit)
        .to_list()
    )
    total = await ChatLog.find(query).count()

    request_ids = [str(message.id) for message in requests]
    reply_map: dict[str, list[TeacherHelpReplyResponse]] = {request_id: [] for request_id in request_ids}
    replies: list[ChatLog] = []
    if request_ids:
        replies = (
            await ChatLog.find(
                {
                    "project_id": project_id,
                    "metadata.help_request_id": {"$in": request_ids},
                    "$or": [
                        {"metadata.teacher_private_reply": True},
                        {"metadata.teacher_support": True},
                    ],
                }
            )
            .sort("created_at")
            .to_list()
        )

    user_ids = [
        message.user_id
        for message in [*requests, *replies]
        if message.user_id
    ]
    users: dict[str, User] = {}
    if user_ids:
        import bson

        object_ids = [bson.ObjectId(uid) for uid in user_ids if bson.ObjectId.is_valid(uid)]
        user_list = await User.find({"_id": {"$in": object_ids}}).to_list()
        users = {str(user.id): user for user in user_list}

    for reply in replies:
        reply_request_id = (reply.metadata or {}).get("help_request_id")
        if reply_request_id in reply_map:
            reply_map[reply_request_id].append(build_help_reply_response(reply, users))

    return TeacherHelpRequestListResponse(
        requests=[
            build_help_request_response(message, users, reply_map.get(str(message.id), []))
            for message in requests
        ],
        total=total,
    )


@router.post(
    "/projects/{project_id}/teacher-help-requests",
    response_model=ChatLogResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_teacher_help_request(
    project_id: str,
    payload: TeacherHelpRequestCreate,
    current_user: User = Depends(get_current_user),
) -> ChatLogResponse:
    """Create a low-frequency student request for teacher support."""
    if current_user.role != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only students can request teacher support from this endpoint",
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
            detail="You don't have permission to request support for this project",
        )

    content = payload.content.strip()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Help request content cannot be empty",
        )
    pending_count = await ChatLog.find(
        {
            "project_id": project_id,
            "user_id": str(current_user.id),
            "metadata.teacher_help_request": True,
            "metadata.status": "pending",
        }
    ).count()
    if pending_count >= 5:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many pending help requests. Please wait for teacher feedback or mark resolved first.",
        )

    now = datetime.utcnow()
    room_id = f"project:{project_id}"
    client_message_id = f"teacher-help-{uuid.uuid4().hex}"
    metadata = {
        "client_message_id": client_message_id,
        "source": "student_teacher_support",
        "teacher_help_request": True,
        "help_type": payload.help_type,
        "allow_public_reply": payload.allow_public_reply,
        "stage_id": payload.stage_id,
        "page_source": payload.page_source,
        "status": "pending",
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
        action="request",
        metadata={
            "help_type": payload.help_type,
            "allow_public_reply": payload.allow_public_reply,
            "stage_id": payload.stage_id,
            "page_source": payload.page_source,
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
                "actor_type": "student",
                "event_domain": "dialogue",
                "event_type": "teacher_help_request",
                "stage_id": current_stage,
                "payload": {
                    "help_type": payload.help_type,
                    "allow_public_reply": payload.allow_public_reply,
                    "page_source": payload.page_source,
                    "message_length": len(content),
                    "source": "student_teacher_support",
                    "client_message_id": client_message_id,
                },
            }
        ],
        current_user_id=str(current_user.id),
    )

    return build_chat_response(chat_log, {str(current_user.id): current_user})


@router.post(
    "/teacher-help-requests/{message_id}/reply",
    response_model=TeacherHelpReplyResponse,
    status_code=status.HTTP_201_CREATED,
)
async def reply_teacher_help_request(
    message_id: str,
    payload: TeacherHelpReplyCreate,
    current_user: User = Depends(get_current_user),
) -> TeacherHelpReplyResponse:
    """Reply to a student help request, privately or as public group guidance."""
    if current_user.role not in {"teacher", "admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only teachers and admins can reply to teacher help requests",
        )

    request_message = await ChatLog.get(message_id)
    if not request_message or not (request_message.metadata or {}).get("teacher_help_request"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Help request not found",
        )

    project = await Project.get(request_message.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    if not await check_project_member_permission(current_user, project):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to reply to this help request",
        )

    content = payload.content.strip()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reply content cannot be empty",
        )

    request_metadata = dict(request_message.metadata or {})
    allow_public_reply = bool(request_metadata.get("allow_public_reply"))
    public_reply = bool(payload.public_reply and allow_public_reply)
    now = datetime.utcnow()
    room_id = f"project:{request_message.project_id}"
    client_message_id = f"teacher-reply-{uuid.uuid4().hex}"
    reply_metadata = {
        "client_message_id": client_message_id,
        "source": "teacher_monitor",
        "help_request_id": str(request_message.id),
        "support_type": payload.support_type,
        "public_reply": public_reply,
    }
    if public_reply:
        reply_metadata["teacher_support"] = True
    else:
        reply_metadata["teacher_private_reply"] = True

    reply_log = ChatLog(
        project_id=request_message.project_id,
        user_id=str(current_user.id),
        content=content,
        message_type="text",
        mentions=[],
        metadata=reply_metadata,
        created_at=now,
    )
    await reply_log.insert()

    request_metadata["status"] = "replied"
    request_metadata["replied_by"] = str(current_user.id)
    request_metadata["replied_at"] = now.isoformat()
    request_message.metadata = request_metadata
    await request_message.save()

    await activity_service.log_activity(
        project_id=request_message.project_id,
        user_id=str(current_user.id),
        module="teacher_support",
        action="group_guidance_send" if public_reply else "private_reply",
        target_id=str(request_message.id),
        metadata={
            "support_type": payload.support_type,
            "public_reply": public_reply,
            "message_length": len(content),
        },
    )

    experiment_version = getattr(project, "experiment_version", None) or {}
    current_stage = request_metadata.get("stage_id") or experiment_version.get("current_stage")
    experiment_version_id = (
        experiment_version.get("version_name")
        or experiment_version.get("name")
        or experiment_version.get("template_release_id")
    )
    await research_event_service.record_batch_events(
        events=[
            {
                "project_id": request_message.project_id,
                "experiment_version_id": experiment_version_id,
                "room_id": room_id,
                "group_id": room_id,
                "user_id": str(current_user.id),
                "actor_type": "teacher",
                "event_domain": "dialogue",
                "event_type": "teacher_group_guidance_send" if public_reply else "teacher_private_reply",
                "stage_id": current_stage,
                "payload": {
                    "help_request_id": str(request_message.id),
                    "support_type": payload.support_type,
                    "public_reply": public_reply,
                    "student_allowed_public_reply": allow_public_reply,
                    "message_length": len(content),
                    "source": "teacher_monitor",
                    "client_message_id": client_message_id,
                },
            }
        ],
        current_user_id=str(current_user.id),
    )

    if public_reply:
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

    return build_help_reply_response(reply_log, {str(current_user.id): current_user})


@router.patch(
    "/teacher-help-requests/{message_id}/status",
    response_model=TeacherHelpRequestResponse,
)
async def update_teacher_help_request_status(
    message_id: str,
    payload: TeacherHelpRequestStatusUpdate,
    current_user: User = Depends(get_current_user),
) -> TeacherHelpRequestResponse:
    """Mark a student help request as pending, replied, or resolved."""
    message = await ChatLog.get(message_id)
    if not message or not (message.metadata or {}).get("teacher_help_request"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Help request not found",
        )

    project = await Project.get(message.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    if not await check_project_member_permission(current_user, project):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to update this help request",
        )
    if current_user.role == "student":
        if message.user_id != str(current_user.id) or payload.status != "resolved":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Students can only mark their own help requests as resolved",
            )
    elif current_user.role not in {"teacher", "admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only students, teachers, and admins can update help request status",
        )

    metadata = dict(message.metadata or {})
    metadata["status"] = payload.status
    metadata["status_updated_by"] = str(current_user.id)
    metadata["status_updated_at"] = datetime.utcnow().isoformat()
    message.metadata = metadata
    await message.save()

    await activity_service.log_activity(
        project_id=message.project_id,
        user_id=str(current_user.id),
        module="teacher_support",
        action=f"help_request_{payload.status}",
        target_id=str(message.id),
        metadata={"help_type": metadata.get("help_type")},
    )

    if payload.status == "resolved":
        experiment_version = getattr(project, "experiment_version", None) or {}
        experiment_version_id = (
            experiment_version.get("version_name")
            or experiment_version.get("name")
            or experiment_version.get("template_release_id")
        )
        await research_event_service.record_batch_events(
            events=[
                {
                    "project_id": message.project_id,
                    "experiment_version_id": experiment_version_id,
                    "room_id": f"project:{message.project_id}",
                    "group_id": f"project:{message.project_id}",
                    "user_id": str(current_user.id),
                    "actor_type": current_user.role,
                    "event_domain": "dialogue",
                    "event_type": "teacher_support_resolved",
                    "stage_id": metadata.get("stage_id") or experiment_version.get("current_stage"),
                    "payload": {
                        "help_request_id": str(message.id),
                        "help_type": metadata.get("help_type"),
                        "source": "student_teacher_support",
                    },
                }
            ],
            current_user_id=str(current_user.id),
        )

    requester = await User.get(message.user_id)
    users = {str(requester.id): requester} if requester else {}
    return build_help_request_response(message, users)


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
                "event_type": "teacher_group_guidance_send",
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
