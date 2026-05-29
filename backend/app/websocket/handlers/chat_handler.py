import logging
# from app.repositories.chat_log import ChatLog # Avoid circular imports if any, but should be fine
# Dynamic import inside function is safer if we are not sure about initialization order
import datetime
import asyncio
import re
import time
import uuid
from typing import Any, Dict, Optional

from app.services.agents.auto_prompt_policy import (
    AUTO_GROUP_PROMPT_RULE_TYPES,
    RULE_TYPE_TO_SUBAGENT,
    is_rule_eligible_for_live_group_prompt,
)
from app.services.agents.multi_agent_roles import (
    AUTO_PROMPT_SENDER_IDS,
    ROLE_KEY_TO_SUBAGENT,
    ROLE_MENTION_MAP,
    SUBAGENT_LABELS,
)
from app.services.agents.multi_agent_stage_matrix import RULE_TYPE_LABELS, STAGE_LABELS

logger = logging.getLogger(__name__)

GENERAL_AI_MENTIONS = {
    "@AISCL智能助手",
    "@AISCL",
    "@AI",
    "@AI智能助手",
    "@智能助手",
    "@智能体",
    "@智能导师",
}

def _utc_iso_timestamp() -> str:
    """Return an ISO timestamp that browsers unambiguously parse as UTC."""
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


THINK_BLOCK_PATTERN = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
MAX_CHAT_MESSAGE_CHARS = 1000
MAX_CHAT_MENTIONS = 20
MAX_CHAT_FILENAME_CHARS = 255
GROUP_AI_PEER_MEMORY_LIMIT = 24
GROUP_AI_INTERACTION_MEMORY_LINE_LIMIT = 16
GROUP_AI_MEMORY_MESSAGE_CHARS = 420


def _normalize_ai_scaffold_mode(value: Optional[str]) -> str:
    """Normalize experiment AI mode; legacy/null projects use generic AI."""
    normalized = str(value or "").strip().lower().replace("-", "_")
    if normalized in {"multi_agent", "multi", "multiagent", "multi_ai"}:
        return "multi_agent"
    if normalized in {"single_agent", "single", "singleai", "single_ai", "general_ai"}:
        return "single_agent"
    return "single_agent"


def _default_chat_model_id(experiment_version: Optional[dict]) -> str:
    return (
        (experiment_version or {}).get("default_chat_model")
        or (experiment_version or {}).get("defaultChatModel")
        or "follow_system_default"
    )


def _group_multi_agent_model_id(experiment_version: Optional[dict]) -> str:
    return (
        (experiment_version or {}).get("group_multi_agent_model")
        or (experiment_version or {}).get("group_chat_model")
        or (experiment_version or {}).get("groupChatModel")
        or "follow_system_default"
    )


def _detect_preferred_subagent(content: str) -> str | None:
    normalized_content = (content or "").replace("＠", "@")
    for mention, subagent in ROLE_MENTION_MAP.items():
        if mention in normalized_content:
            return subagent
    return None


def _label_stage(stage_id: Optional[str]) -> Optional[str]:
    if not stage_id:
        return None
    return STAGE_LABELS.get(stage_id, stage_id)


def _label_rule_type(rule_type: Optional[str]) -> Optional[str]:
    if not rule_type:
        return None
    return RULE_TYPE_LABELS.get(rule_type, rule_type)


def _build_group_ai_meta(selected_subagent: Optional[str], routing_decision: dict) -> dict:
    role_label = SUBAGENT_LABELS.get(selected_subagent, "AISCL智能助手")
    current_stage = _label_stage(routing_decision.get("current_stage"))
    rule_label = _label_rule_type(routing_decision.get("rule_type"))
    routing_source = routing_decision.get("routing_source")

    if rule_label:
        rationale = f"依据当前阶段与触发规则，优先由{role_label}进行回应。"
    elif routing_source == "preferred_subagent":
        rationale = f"依据小组在群聊中的角色提及，本轮优先由{role_label}回应。"
    elif current_stage:
        rationale = f"依据当前协作阶段，本轮优先由{role_label}回应。"
    else:
        rationale = f"依据当前上下文，本轮优先由{role_label}回应。"

    routing_summary = []
    if current_stage:
        routing_summary.append(f"当前阶段：{current_stage}")
    if rule_label:
        routing_summary.append(f"触发依据：{rule_label}")
    if routing_source:
        routing_summary.append(f"决策来源：{routing_source}")
    intervention_mode = routing_decision.get("intervention_mode")
    if intervention_mode:
        routing_summary.append(f"支架方式：{intervention_mode}")

    return {
        "primary_agent": role_label,
        "rationale_summary": rationale,
        "routing_summary": routing_summary,
    }


def _extract_routing_context(project: object, content: str) -> dict:
    experiment_version = getattr(project, "experiment_version", None) or {}
    ai_scaffold_mode = _normalize_ai_scaffold_mode(experiment_version.get("ai_scaffold_mode"))
    enabled_roles = experiment_version.get("enabled_scaffold_roles") or []
    enabled_subagents = []
    preferred_subagent = None
    if ai_scaffold_mode == "multi_agent":
        enabled_subagents = [
            ROLE_KEY_TO_SUBAGENT[role]
            for role in enabled_roles
            if role in ROLE_KEY_TO_SUBAGENT
        ]
        preferred_subagent = _detect_preferred_subagent(content)
    return {
        "project_id": str(getattr(project, "id", "")) if project else None,
        "experiment_version_id": experiment_version.get("version_name") or experiment_version.get("name"),
        "current_stage": experiment_version.get("current_stage"),
        "ai_scaffold_mode": ai_scaffold_mode,
        "process_scaffold_mode": experiment_version.get("process_scaffold_mode"),
        "enabled_scaffold_roles": enabled_roles,
        "enabled_subagents": enabled_subagents,
        "preferred_subagent": preferred_subagent,
    }


def _sanitize_stream_display_content(raw_text: str) -> str:
    """Strip reasoning wrappers during incremental display."""
    if not raw_text:
        return ""
    cleaned = THINK_BLOCK_PATTERN.sub("", raw_text)
    open_index = cleaned.rfind("<think>")
    if open_index != -1:
        cleaned = cleaned[:open_index]
    cleaned = cleaned.replace("<think>", "").replace("</think>", "")
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _build_empty_ai_reply_fallback(current_stage: Optional[str] = None) -> str:
    stage_label = STAGE_LABELS.get(current_stage or "", "")
    stage_clause = f"当前处在“{stage_label}”阶段，" if stage_label else ""
    return (
        f"AISCL智能助手本轮没有生成可显示的完整回应。{stage_clause}"
        "你们可以先把当前问题收束成一句话，再补一条已有依据和一个下一步分工；"
        "如果需要我继续支持，请直接说明“帮我们澄清问题/找证据/挑战观点/追问修改方向”。"
    )


def _truncate_memory_text(text: str, max_chars: int = GROUP_AI_MEMORY_MESSAGE_CHARS) -> str:
    """Keep group memory compact enough for every AI turn."""
    normalized = re.sub(r"\s+", " ", text or "").strip()
    if len(normalized) <= max_chars:
        return normalized
    return normalized[:max_chars].rstrip() + "..."


async def _build_recent_group_chat_context(
    *,
    project_id: str,
    current_message_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Build layered short-term group memory from persisted chat logs.

    This is intentionally retrieved from ChatLog instead of LangGraph memory so
    it survives page refreshes and works for both single-AI and multi-agent modes.
    """
    from app.repositories.chat_log import ChatLog
    from app.repositories.user import User

    query = {
        "project_id": project_id,
        "metadata.teacher_help_request": {"$ne": True},
        "metadata.teacher_private_reply": {"$ne": True},
    }
    messages = (
        await ChatLog.find(query)
        .sort("-created_at")
        .limit(GROUP_AI_PEER_MEMORY_LIMIT + GROUP_AI_INTERACTION_MEMORY_LINE_LIMIT + 12)
        .to_list()
    )

    filtered_messages = [
        message
        for message in messages
        if str(message.id) != str(current_message_id)
    ]
    if not filtered_messages:
        return {
            "content": "",
            "peer_context": "",
            "ai_context": "",
            "peer_message_count": 0,
            "ai_interaction_count": 0,
            "message_count": 0,
        }

    user_ids = [
        message.user_id
        for message in filtered_messages
        if message.user_id
        and message.user_id not in {"system", "ai_assistant"}
        and not message.user_id.startswith("auto_prompt:")
    ]
    users = {}
    if user_ids:
        import bson

        object_ids = [bson.ObjectId(uid) for uid in set(user_ids) if bson.ObjectId.is_valid(uid)]
        if object_ids:
            user_list = await User.find({"_id": {"$in": object_ids}}).to_list()
            users = {str(user.id): user for user in user_list}

    peer_lines = []
    ai_lines = []
    for message in reversed(filtered_messages):
        metadata = message.metadata or {}
        is_ai_sender = message.user_id == "ai_assistant" or message.user_id.startswith("auto_prompt:")
        user = users.get(message.user_id)
        if user:
            username = user.username or user.email
        elif message.user_id == "ai_assistant":
            ai_meta = metadata.get("ai_meta") if isinstance(metadata, dict) else None
            username = (
                ai_meta.get("primary_agent")
                if isinstance(ai_meta, dict) and ai_meta.get("primary_agent")
                else "AISCL智能助手"
            )
        elif message.user_id.startswith("auto_prompt:"):
            username = SUBAGENT_LABELS.get(message.user_id.replace("auto_prompt:", ""), "支架提示")
        else:
            username = "System"

        content = message.content or ""
        file_info = metadata.get("file_info") if isinstance(metadata, dict) else None
        if not content.strip() and isinstance(file_info, dict):
            content = f"[文件/图片：{file_info.get('name') or file_info.get('filename') or '未命名附件'}]"
        if not content.strip():
            continue

        time_label = message.created_at.strftime("%H:%M") if message.created_at else ""
        line = f"- [{time_label}] {username}: {_truncate_memory_text(content)}"
        contains_ai_mention = bool(_detect_preferred_subagent(content)) or any(
            keyword in content
            for keyword in GENERAL_AI_MENTIONS
        )
        if is_ai_sender or contains_ai_mention:
            ai_lines.append(line)
        elif message.user_id != "system":
            peer_lines.append(line)

    peer_lines = peer_lines[-GROUP_AI_PEER_MEMORY_LIMIT:]
    ai_lines = ai_lines[-GROUP_AI_INTERACTION_MEMORY_LINE_LIMIT:]

    peer_context = (
        "小组最近讨论（由旧到新，不含当前提问）：\n" + "\n".join(peer_lines)
        if peer_lines
        else ""
    )
    ai_context = (
        "小组 AI 互动历史（由旧到新，不含当前提问）：\n" + "\n".join(ai_lines)
        if ai_lines
        else ""
    )
    combined_context = "\n\n".join(section for section in [peer_context, ai_context] if section)

    return {
        "content": combined_context,
        "peer_context": peer_context,
        "ai_context": ai_context,
        "peer_message_count": len(peer_lines),
        "ai_interaction_count": len(ai_lines),
        "message_count": len(peer_lines) + len(ai_lines),
    }


async def _count_online_learners(room_id: str) -> int:
    """Count currently online student users in one room."""
    from app.repositories.user import User
    from app.websocket.socketio_server import room_members

    members = room_members.get(room_id, {})
    if not members:
        return 0

    count = 0
    for member_user_id in members.keys():
        user = await User.get(member_user_id)
        if user and user.role == "student":
            count += 1
    return count


async def _evaluate_shadow_prompt_candidates(
    *,
    sio,
    project: object,
    room_id: str,
    current_user_id: str,
    current_user_role: str,
) -> None:
    """Evaluate shadow-mode auto group prompts without sending them."""
    if current_user_role != "student" or not project:
        return

    experiment_version = getattr(project, "experiment_version", None) or {}
    if experiment_version.get("mode") != "research":
        return
    if experiment_version.get("process_scaffold_mode") != "on":
        return

    current_stage = experiment_version.get("current_stage")
    enabled_rule_set = experiment_version.get("enabled_rule_set")
    is_multi_agent_mode = experiment_version.get("ai_scaffold_mode") == "multi_agent"
    experiment_version_id = (
        experiment_version.get("version_name")
        or experiment_version.get("name")
    )

    from app.services.intervention_service import intervention_service
    from app.services.research_event_service import research_event_service

    intervention_context = await research_event_service.build_intervention_context_from_events(
        project_id=str(project.id),
        stage_id=current_stage,
        lookback_minutes=20,
        pending_peer_message_count=0,
    )
    matched_interventions = await intervention_service.check_interventions(
        project_id=str(project.id),
        user_id=current_user_id,
        context=intervention_context,
        enabled_rule_set=enabled_rule_set,
    )
    if not matched_interventions:
        return

    online_learner_count = await _count_online_learners(room_id)
    shadow_events = []
    live_prompt_candidate: Optional[Dict[str, Any]] = None
    live_group_prompt_enabled = (
        is_multi_agent_mode
        and intervention_service.is_group_chat_live_enabled(enabled_rule_set)
    )

    for intervention in matched_interventions:
        rule_type = intervention.get("rule_type")
        if not rule_type:
            continue

        policy = await research_event_service.evaluate_shadow_prompt_policy(
            project_id=str(project.id),
            rule_type=rule_type,
            stage_id=current_stage,
            online_learner_count=online_learner_count,
            cooldown_minutes=20,
            observation_window_minutes=8,
            auto_rule_types=AUTO_GROUP_PROMPT_RULE_TYPES,
        )
        if not policy.get("should_record"):
            continue

        eligible_for_live_prompt, eligibility_block_reason = is_rule_eligible_for_live_group_prompt(
            rule_type=rule_type,
            stage_id=current_stage,
            intervention_context=intervention_context,
        )

        recommended_subagent = RULE_TYPE_TO_SUBAGENT.get(rule_type) if is_multi_agent_mode else None
        shadow_events.append(
            {
                "project_id": str(project.id),
                "experiment_version_id": experiment_version_id,
                "room_id": room_id,
                "group_id": room_id,
                "user_id": current_user_id,
                "actor_type": "system",
                "event_domain": "scaffold",
                "event_type": "shadow_prompt_candidate",
                "stage_id": current_stage,
                "payload": {
                    "rule_id": intervention.get("rule_id"),
                    "rule_name": intervention.get("rule_name"),
                    "rule_type": rule_type,
                    "matched": True,
                    "would_send": policy.get("would_send", False),
                    "block_reason": policy.get("block_reason"),
                    "eligibility_block_reason": eligibility_block_reason,
                    "live_prompt_eligible": eligible_for_live_prompt,
                    "enabled_rule_set": enabled_rule_set,
                    "online_learner_count": online_learner_count,
                    "cooldown_minutes": 20,
                    "observation_window_minutes": 8,
                    "window_bucket": policy.get("window_bucket"),
                    "previous_window_bucket": policy.get("previous_window_bucket"),
                    "consecutive_window_count": policy.get("consecutive_window_count", 0),
                    "recommended_subagent": recommended_subagent,
                    "recommended_role_label": SUBAGENT_LABELS.get(recommended_subagent, "协作提示"),
                    "recommended_message": intervention.get("message"),
                    "intervention_context": intervention_context,
                    "shadow_mode": True,
                },
            }
        )

        if (
            live_group_prompt_enabled
            and policy.get("would_send")
            and eligible_for_live_prompt
            and live_prompt_candidate is None
        ):
            recommended_subagent = RULE_TYPE_TO_SUBAGENT.get(rule_type) if is_multi_agent_mode else None
            live_prompt_candidate = {
                "project_id": str(project.id),
                "experiment_version_id": experiment_version_id,
                "room_id": room_id,
                "group_id": room_id,
                "stage_id": current_stage,
                "rule_type": rule_type,
                "rule_name": intervention.get("rule_name"),
                "recommended_subagent": recommended_subagent,
                "recommended_role_label": SUBAGENT_LABELS.get(recommended_subagent, "协作提示"),
                "message": intervention.get("message"),
                "enabled_rule_set": enabled_rule_set,
                "online_learner_count": online_learner_count,
                "window_bucket": policy.get("window_bucket"),
                "consecutive_window_count": policy.get("consecutive_window_count", 0),
            }

    if shadow_events:
        await research_event_service.record_batch_events(
            events=shadow_events,
            current_user_id=current_user_id,
        )

    if live_prompt_candidate:
        await _emit_auto_group_prompt(
            sio=sio,
            prompt_data=live_prompt_candidate,
            actor_user_id=current_user_id,
        )


async def _emit_auto_group_prompt(
    *,
    sio,
    prompt_data: Dict[str, Any],
    actor_user_id: Optional[str],
) -> None:
    """Emit one short live auto prompt to group chat and persist it."""
    from app.repositories.chat_log import ChatLog
    from app.services.activity_service import activity_service
    from app.services.research_event_service import research_event_service

    project_id = prompt_data["project_id"]
    room_id = prompt_data["room_id"]
    rule_type = prompt_data["rule_type"]
    recommended_subagent = prompt_data.get("recommended_subagent")
    role_label = prompt_data.get("recommended_role_label") or "协作提示"
    message = prompt_data.get("message") or "请继续推进当前协作任务。"
    sender_id = AUTO_PROMPT_SENDER_IDS.get(recommended_subagent, "auto_prompt:assistant")
    prompt_text = f"【{role_label}】{message}" if recommended_subagent is None else f"【{role_label}提示】{message}"
    ai_meta = {
        "primary_agent": role_label,
        "rationale_summary": (
            "依据当前协作状态与规则命中，系统向小组发出短提示。"
            if recommended_subagent is None
            else f"依据当前协作状态与规则命中，本轮由{role_label}向小组发出短提示。"
        ),
        "routing_summary": [
            f"当前阶段：{_label_stage(prompt_data.get('stage_id')) or '未标记'}",
            f"触发依据：{_label_rule_type(rule_type) or rule_type}",
            "提示方式：低频群聊短提示",
        ],
    }

    chat_log = ChatLog(
        project_id=project_id,
        user_id=sender_id,
        content=prompt_text,
        message_type="ai",
        mentions=[],
        metadata={
            "ai_meta": ai_meta,
            "stage_id": prompt_data.get("stage_id"),
            "experiment_version_id": prompt_data.get("experiment_version_id"),
        },
    )
    await chat_log.insert()

    await activity_service.log_activity(
        project_id=project_id,
        user_id=sender_id,
        module="chat",
        action="auto_group_prompt_send",
        metadata={
            "rule_type": rule_type,
            "recommended_subagent": recommended_subagent,
            "room_id": room_id,
        },
    )

    await research_event_service.record_batch_events(
        events=[
            {
                "project_id": project_id,
                "experiment_version_id": prompt_data.get("experiment_version_id"),
                "room_id": room_id,
                "group_id": prompt_data.get("group_id"),
                "user_id": actor_user_id,
                "actor_type": "system",
                "event_domain": "scaffold",
                "event_type": "auto_group_prompt_send",
                "stage_id": prompt_data.get("stage_id"),
                "payload": {
                    "rule_type": rule_type,
                    "rule_name": prompt_data.get("rule_name"),
                    "recommended_subagent": recommended_subagent,
                    "recommended_role_label": role_label,
                    "enabled_rule_set": prompt_data.get("enabled_rule_set"),
                    "online_learner_count": prompt_data.get("online_learner_count"),
                    "window_bucket": prompt_data.get("window_bucket"),
                    "consecutive_window_count": prompt_data.get("consecutive_window_count"),
                    "live_group_prompt": True,
                },
            }
        ],
        current_user_id=actor_user_id,
    )

    timestamp = _utc_iso_timestamp()
    response_op = {
        "id": str(uuid.uuid4()),
        "module": "chat",
        "roomId": room_id,
        "type": "message",
        "clientId": sender_id,
        "data": {
            "messageId": str(chat_log.id),
            "content": prompt_text,
            "mentions": [],
            "sender": {
                "id": sender_id,
                "username": role_label,
                "avatar": "/avatars/ai_assistant.png",
            },
            "aiMeta": ai_meta,
        },
        "timestamp": timestamp,
    }
    await sio.emit("operation", response_op, room=room_id)


async def _process_ai_reply(
    sio,
    room_id,
    project_id,
    user_content,
    session_id,
    routing_context=None,
    current_message_id: Optional[str] = None,
):
    """Process AI response in background and broadcast."""
    typing_started = False
    try:
        from app.services.agents.agent_service import agent_service
        from app.services.agents.deep_agents_shim import derive_routing_decision_from_context
        from app.services.ai_service import ai_service
        from app.repositories.project import Project
        from app.repositories.chat_log import ChatLog
        from app.services.activity_service import activity_service
        from app.services.group_memory_service import group_memory_service
        
        # Emit typing event
        await sio.emit('typing', {
            'roomId': room_id,
            'userId': 'ai_assistant',
            'username': 'AISCL智能助手'
        }, room=room_id)
        typing_started = True

        # Accumulate response
        full_response = ""
        displayed_response = ""
        project = await Project.get(project_id)
        experiment_version = getattr(project, "experiment_version", None) or {}
        current_stage = experiment_version.get("current_stage")
        ai_scaffold_mode = _normalize_ai_scaffold_mode(
            experiment_version.get("ai_scaffold_mode") or (routing_context or {}).get("ai_scaffold_mode")
        )
        group_memory: Dict[str, Any] = await _build_recent_group_chat_context(
            project_id=project_id,
            current_message_id=current_message_id,
        )
        stage_memory: Dict[str, Any] = {}
        group_state: Dict[str, Any] = {}
        project_task_context = await group_memory_service.get_project_task_context(project)
        if ai_scaffold_mode == "multi_agent":
            stage_memory = await group_memory_service.get_stage_memory_context(
                project_id=project_id,
                group_id=room_id,
                stage_id=current_stage,
            )
            group_state = await group_memory_service.refresh_and_get_group_state_context(
                project_id=project_id,
                group_id=room_id,
                stage_id=current_stage,
                project=project,
            )
        # Using project_id as session_id for continuity within the project
        graph_context = {
            **(routing_context or {}),
            "project_id": project_id,
            "room_id": room_id,
            "group_id": room_id,
            "source_actor_type": "ai_assistant",
            "project_task_context": project_task_context,
            "stage_memory_context": stage_memory.get("content"),
            "stage_memory_updated_at": stage_memory.get("updated_at"),
            "stage_memory_id": stage_memory.get("memory_id"),
            "stage_memory_version": stage_memory.get("version"),
            "group_state_context": group_state.get("content"),
            "group_state_updated_at": group_state.get("updated_at"),
            "group_state_memory_id": group_state.get("memory_id"),
            "group_state_memory_version": group_state.get("version"),
            "group_chat_context": group_memory.get("content"),
            "group_peer_context": group_memory.get("peer_context"),
            "group_ai_context": group_memory.get("ai_context"),
            "group_memory_message_count": group_memory.get("message_count", 0),
            "group_peer_message_count": group_memory.get("peer_message_count", 0),
            "group_ai_interaction_count": group_memory.get("ai_interaction_count", 0),
            "graph_version": experiment_version.get("graph_version"),
            "ai_scaffold_mode": ai_scaffold_mode,
            "process_scaffold_mode": experiment_version.get("process_scaffold_mode"),
            "runtime_model_id": _group_multi_agent_model_id(experiment_version),
        }
        ai_user_id = "ai_assistant"
        message_id = str(uuid.uuid4())
        message_timestamp = _utc_iso_timestamp()
        last_emit_time = 0.0
        routing_decision = {}
        ai_meta = None
        if ai_scaffold_mode == "multi_agent":
            ai_meta = {
                "primary_agent": "AI智能助手",
                "rationale_summary": "我会结合项目任务、当前阶段和小组近期讨论进行回应。",
                "routing_summary": [
                    "已读取项目任务说明" if project_task_context else "暂无项目任务说明",
                    f"阶段滚动记忆：{'已读取' if stage_memory.get('content') else '暂无'}",
                    f"小组状态记忆：{'已读取' if group_state.get('content') else '暂无'}",
                    f"小组讨论记忆：最近{group_memory.get('peer_message_count', 0)}条",
                    f"小组AI互动记忆：最近{group_memory.get('ai_interaction_count', 0)}条",
                ],
            }

        async def emit_partial(content: str) -> None:
            response_op = {
                "id": str(uuid.uuid4()),
                "module": "chat",
                "roomId": room_id,
                "type": "message",
                "clientId": ai_user_id,
                "data": {
                    "messageId": message_id,
                    "content": content,
                    "mentions": [],
                    "aiMeta": ai_meta,
                    "sender": {
                        "id": ai_user_id,
                        "username": "AISCL智能助手",
                        "avatar": "/avatars/ai_assistant.png"
                    }
                },
                "timestamp": message_timestamp,
            }
            await sio.emit("operation", response_op, room=room_id)

        if ai_scaffold_mode == "single_agent":
            direct_context_messages = []
            if project_task_context:
                direct_context_messages.append({
                    "role": "user",
                    "content": f"本小组任务说明：\n{project_task_context}",
                })
            if group_memory.get("peer_context"):
                direct_context_messages.append({
                    "role": "user",
                    "content": group_memory["peer_context"],
                })
            if group_memory.get("ai_context"):
                direct_context_messages.append({
                    "role": "user",
                    "content": group_memory["ai_context"],
                })

            async for chunk in ai_service.raw_completion_stream(
                user_content,
                model_id=_default_chat_model_id(experiment_version),
                context_messages=direct_context_messages,
            ):
                full_response += chunk
                candidate_display = _sanitize_stream_display_content(full_response)
                now = time.monotonic()
                should_emit = (
                    candidate_display
                    and candidate_display != displayed_response
                    and (
                        now - last_emit_time >= 0.12
                        or any(mark in chunk for mark in ("\n", "。", "！", "？", ".", "!", "?"))
                    )
                )
                if should_emit:
                    displayed_response = candidate_display
                    last_emit_time = now
                    await emit_partial(displayed_response)
        else:
            routing_decision = derive_routing_decision_from_context(
                subagents=agent_service._get_research_subagents(),
                context=graph_context,
            ) or {}
            ai_meta = _build_group_ai_meta(
                routing_decision.get("selected_subagent"),
                routing_decision,
            )
            ai_meta.setdefault("routing_summary", []).extend([
                "已读取项目任务说明" if project_task_context else "暂无项目任务说明",
                f"阶段滚动记忆：{'已读取' if stage_memory.get('content') else '暂无'}",
                f"小组状态记忆：{'已读取' if group_state.get('content') else '暂无'}",
                f"小组讨论记忆：最近{group_memory.get('peer_message_count', 0)}条",
                f"小组AI互动记忆：最近{group_memory.get('ai_interaction_count', 0)}条",
            ])

            async for event in agent_service.chat_stream(
                persona_key="supervisor", # Entry point
                message=user_content,
                session_id=session_id,
                context=graph_context,
            ):
                if isinstance(event, dict):
                    event_type = event.get("type")
                    if event_type == "routing":
                        routing_decision = event.get("routing_decision") or routing_decision
                        if event.get("ai_meta"):
                            ai_meta = {**ai_meta, **event["ai_meta"]}
                        continue
                    if event_type in {"process_start", "process_step", "retrieval_step", "routing_step", "process_done"}:
                        message = (event.get("message") or "").strip()
                        if message:
                            summary = list(ai_meta.get("processing_summary") or [])
                            if message not in summary:
                                ai_meta["processing_summary"] = [*summary, message]
                            await emit_partial(displayed_response or " ")
                        continue
                    if event_type in {"thinking_start", "thinking", "thinking_end", "output_start", "output_end", "status"}:
                        continue
                    if event_type == "done":
                        if event.get("ai_meta"):
                            ai_meta = {**ai_meta, **event["ai_meta"]}
                        if event.get("final_content"):
                            full_response = event["final_content"]
                        continue
                    if event_type != "output":
                        continue
                    chunk = event.get("content", "")
                else:
                    chunk = event
                full_response += chunk
                candidate_display = _sanitize_stream_display_content(full_response)
                now = time.monotonic()
                should_emit = (
                    candidate_display
                    and candidate_display != displayed_response
                    and (
                        now - last_emit_time >= 0.12
                        or any(mark in chunk for mark in ("\n", "。", "！", "？", ".", "!", "?"))
                    )
                )
                if should_emit:
                    displayed_response = candidate_display
                    last_emit_time = now
                    await emit_partial(displayed_response)

        final_response = _sanitize_stream_display_content(full_response)

        if not final_response:
            logger.warning(
                "AI reply generated empty display content; applying fallback "
                "project=%s room=%s mode=%s stage=%s message_id=%s",
                project_id,
                room_id,
                ai_scaffold_mode,
                current_stage,
                message_id,
            )
            final_response = _build_empty_ai_reply_fallback(current_stage)
            ai_meta = dict(ai_meta or {})
            processing_summary = list(ai_meta.get("processing_summary") or [])
            fallback_note = "模型本轮没有返回可显示正文，已启用兜底提示。"
            if fallback_note not in processing_summary:
                processing_summary.append(fallback_note)
            routing_summary = list(ai_meta.get("routing_summary") or [])
            if "空回复兜底提示" not in routing_summary:
                routing_summary.append("空回复兜底提示")
            ai_meta.update(
                {
                    "primary_agent": ai_meta.get("primary_agent") or "AISCL智能助手",
                    "rationale_summary": ai_meta.get("rationale_summary")
                    or "模型本轮未返回可显示正文，先给出小组协作的最小支架。",
                    "routing_summary": routing_summary,
                    "processing_summary": processing_summary,
                }
            )

        # Save to DB
        chat_log = ChatLog(
            project_id=project_id,
            user_id=ai_user_id,
            content=final_response,
            message_type="text",
            mentions=[],
            metadata={
                "client_message_id": message_id,
                "ai_meta": ai_meta,
                "stage_id": current_stage,
                "experiment_version_id": (
                    experiment_version.get("version_name") or experiment_version.get("name")
                ),
            },
        )
        await chat_log.insert()
        
        # Log activity
        await activity_service.log_activity(
            project_id=project_id,
            user_id=ai_user_id,
            module="chat",
            action="reply",
            metadata={
                "length": len(final_response),
                "stage_memory_id": stage_memory.get("memory_id"),
                "stage_memory_version": stage_memory.get("version"),
                "group_state_memory_id": group_state.get("memory_id"),
                "group_state_memory_version": group_state.get("version"),
                "group_memory_message_count": group_memory.get("message_count", 0),
                "group_peer_message_count": group_memory.get("peer_message_count", 0),
                "group_ai_interaction_count": group_memory.get("ai_interaction_count", 0),
            }
        )

        if final_response != displayed_response:
            await emit_partial(final_response)

        if ai_scaffold_mode == "multi_agent":
            asyncio.create_task(
                group_memory_service.maybe_refresh_stage_memory(
                    project_id=project_id,
                    group_id=room_id,
                    stage_id=current_stage,
                    trigger="on_ai_request",
                )
            )
            asyncio.create_task(
                group_memory_service.maybe_refresh_group_state_memory(
                    project_id=project_id,
                    group_id=room_id,
                    stage_id=current_stage,
                    project=project,
                    trigger="on_ai_request",
                )
            )
        
    except Exception as e:
        logger.exception("Error processing AI reply for project %s: %s", project_id, e)
        try:
            fallback_text = (
                "AISCL智能助手暂时没有成功生成回应。请稍后重试，或先把当前问题、已有依据和下一步分工写在群聊中。"
            )
            fallback_id = str(uuid.uuid4())
            fallback_timestamp = _utc_iso_timestamp()
            from app.repositories.chat_log import ChatLog

            chat_log = ChatLog(
                project_id=project_id,
                user_id="ai_assistant",
                content=fallback_text,
                message_type="text",
                mentions=[],
                metadata={
                    "client_message_id": fallback_id,
                    "ai_meta": {
                        "primary_agent": "AISCL智能助手",
                        "rationale_summary": "AI 服务临时异常，已给出最小可执行提示。",
                        "routing_summary": ["生成失败兜底提示"],
                    },
                },
            )
            await chat_log.insert()
            await sio.emit(
                "operation",
                {
                    "id": str(uuid.uuid4()),
                    "module": "chat",
                    "roomId": room_id,
                    "type": "message",
                    "clientId": "ai_assistant",
                    "data": {
                        "messageId": fallback_id,
                        "content": fallback_text,
                        "mentions": [],
                        "aiMeta": chat_log.metadata.get("ai_meta") if chat_log.metadata else None,
                        "sender": {
                            "id": "ai_assistant",
                            "username": "AISCL智能助手",
                            "avatar": "/avatars/ai_assistant.png",
                        },
                    },
                    "timestamp": fallback_timestamp,
                },
                room=room_id,
            )
        except Exception as fallback_error:  # noqa: BLE001
            logger.error("Failed to emit AI fallback message for %s: %s", project_id, fallback_error)
    finally:
        if typing_started:
            await sio.emit('stop_typing', {
                'roomId': room_id,
                'userId': 'ai_assistant',
                'username': 'AISCL智能助手'
            }, room=room_id)

async def handle_chat_op(sio, sid, data, user_id):
    """
    Handle chat operation.
    data (Operation): {
        "id": "...",
        "module": "chat",
        "roomId": "...",
        "type": "message",
        "data": { // ChatOperationData
            "messageId": "...",
            "content": "...",
            "mentions": []
        },
        "timestamp": ...
    }
    """
    room_id = data.get("roomId")
    op_type = data.get("type")
    op_payload = data.get("data", {})
    
    if not room_id:
        return

    if op_type == "presence":
        try:
            project_id = room_id.split(":")[-1]
            presence_payload = op_payload.get("presence") if isinstance(op_payload, dict) else {}
            if not isinstance(presence_payload, dict):
                presence_payload = {}

            from app.repositories.project import Project
            from app.repositories.user import User
            from app.services.research_event_service import research_event_service

            project = await Project.get(project_id)
            experiment_version = (getattr(project, "experiment_version", None) or {}) if project else {}
            sender = await User.get(user_id)
            current_stage = presence_payload.get("currentStage") or experiment_version.get("current_stage")

            sanitized_presence = {
                "projectId": project_id,
                "username": presence_payload.get("username") or (sender.username if sender else None),
                "avatarUrl": presence_payload.get("avatarUrl") or (sender.avatar_url if sender else None),
                "role": presence_payload.get("role") or (sender.role if sender else None),
                "module": presence_payload.get("module") or "chat",
                "pageSource": presence_payload.get("pageSource"),
                "currentStage": current_stage,
                "lastSeenAt": presence_payload.get("lastSeenAt"),
            }
            data["data"] = {"presence": sanitized_presence}

            await sio.emit("operation", data, room=room_id, skip_sid=sid)

            await research_event_service.record_batch_events(
                events=[
                    {
                        "project_id": project_id,
                        "experiment_version_id": experiment_version.get("version_name") or experiment_version.get("name"),
                        "room_id": room_id,
                        "group_id": room_id,
                        "user_id": user_id,
                        "actor_type": sender.role if sender and sender.role in {"student", "teacher"} else "student",
                        "event_domain": "dialogue",
                        "event_type": "presence_heartbeat",
                        "stage_id": current_stage,
                        "payload": {
                            "module": sanitized_presence.get("module"),
                            "page_source": sanitized_presence.get("pageSource"),
                            "connection_channel": "socketio",
                        },
                    }
                ],
                current_user_id=user_id,
            )
        except Exception as e:
            logger.warning("Error handling presence op for %s: %s", room_id, e)
        return

    if not op_payload:
        return

    if op_type == "message":
        content = str(op_payload.get("content") or "")
        mentions = op_payload.get("mentions", [])
        file_info = op_payload.get("fileInfo")
        if not content.strip() and not file_info:
            return
        if len(content) > MAX_CHAT_MESSAGE_CHARS:
            logger.warning("Rejected oversized chat message from %s in %s", user_id, room_id)
            return
        if not isinstance(mentions, list):
            mentions = []
        mentions = mentions[:MAX_CHAT_MENTIONS]
        if file_info is not None and not isinstance(file_info, dict):
            logger.warning("Rejected invalid chat file payload from %s in %s", user_id, room_id)
            return
        if file_info:
            file_info = {
                "name": str(file_info.get("name") or "image").strip()[:MAX_CHAT_FILENAME_CHARS],
                "size": int(file_info.get("size") or 0),
                "url": str(file_info.get("url") or ""),
                "mime_type": str(file_info.get("mimeType") or file_info.get("mime_type") or ""),
                "resource_id": str(file_info.get("resourceId") or file_info.get("resource_id") or ""),
            }

        try:
            # Resolve Project ID
            # Assuming roomId format "project:ID" or just "ID" (from ChatAdapter adapter logic)
            # In useChatSync: roomId = `project:${projectId}`.
            parts = room_id.split(':')
            project_id = parts[-1]
            from app.repositories.project import Project
            project = await Project.get(project_id)
            
            # Dynamic import to avoid potential circular dependencies at module level
            from app.repositories.chat_log import ChatLog
            from app.repositories.resource import Resource
            from app.repositories.user import User
            from app.services.research_event_service import research_event_service

            experiment_version = (getattr(project, "experiment_version", None) or {}) if project else {}
            current_stage = experiment_version.get("current_stage")
            experiment_version_id = (
                experiment_version.get("version_name") or experiment_version.get("name")
                if experiment_version
                else None
            )

            if file_info:
                resource_id = file_info.get("resource_id")
                try:
                    resource = await Resource.get(resource_id) if resource_id else None
                except Exception:  # noqa: BLE001
                    resource = None
                if (
                    not resource
                    or resource.project_id != project_id
                    or resource.source_type != "chat_attachment"
                ):
                    logger.warning("Rejected unbound chat file payload from %s in %s", user_id, room_id)
                    return
                file_info = {
                    "name": resource.filename[:MAX_CHAT_FILENAME_CHARS],
                    "size": int(resource.size or 0),
                    "url": f"/api/v1/storage/resources/{str(resource.id)}/view",
                    "mime_type": resource.mime_type,
                    "resource_id": str(resource.id),
                }
                op_payload["fileInfo"] = {
                    "name": file_info["name"],
                    "size": file_info["size"],
                    "url": file_info["url"],
                    "mimeType": file_info["mime_type"],
                    "resourceId": file_info["resource_id"],
                }
            
            chat_log = ChatLog(
                project_id=project_id,
                user_id=user_id,
                content=content,
                message_type="file" if file_info else "text",
                mentions=mentions,
                metadata={
                    **(
                        {"client_message_id": op_payload.get("messageId")}
                        if op_payload.get("messageId")
                        else {}
                    ),
                    **({"file_info": file_info} if file_info else {}),
                    **({"stage_id": current_stage} if current_stage else {}),
                    **({"experiment_version_id": experiment_version_id} if experiment_version_id else {}),
                } or None,
            )
            await chat_log.insert()
            
            # Log as activity for dashboard/dynamics
            from app.services.activity_service import activity_service
            await activity_service.log_activity(
                project_id=project_id,
                user_id=user_id,
                module="chat",
                action="send",
                metadata={"length": len(content)}
            )
            
            # Get sender info for richer broadcast
            sender = await User.get(user_id)
            sender_actor_type = sender.role if sender and sender.role in {"student", "teacher"} else "student"

            if sender:
                if "data" not in data:
                    data["data"] = {}
                data["data"]["sender"] = {
                    "id": user_id,
                    "username": sender.username,
                    "avatar": sender.avatar_url
                }

            # Broadcast operation
            await sio.emit("operation", data, room=room_id, skip_sid=sid)
            
            # Check for AI Mentions
            # 1. Structured mentions
            is_ai_mentioned = any(
                (
                    mention.get("id") == "ai_assistant"
                    if isinstance(mention, dict)
                    else str(mention) == "ai_assistant"
                )
                for mention in mentions
            )
            
            # 2. Heuristic text check (for testing or direct typing)
            normalized_content = content.replace("＠", "@")
            ai_keywords = list(ROLE_MENTION_MAP.keys()) + list(GENERAL_AI_MENTIONS)
            if not is_ai_mentioned and any(k in normalized_content for k in ai_keywords):
                is_ai_mentioned = True

            await research_event_service.record_batch_events(
                events=[
                    {
                        "project_id": project_id,
                        "experiment_version_id": experiment_version_id,
                        "room_id": room_id,
                        "group_id": room_id,
                        "user_id": user_id,
                        "actor_type": sender_actor_type,
                        "event_domain": "dialogue",
                        "event_type": "peer_message_send",
                        "stage_id": current_stage,
                        "payload": {
                            "message_length": len(content),
                            "mention_count": len(mentions),
                            "contains_ai_mention": is_ai_mentioned,
                            "preferred_subagent": (
                                _detect_preferred_subagent(content)
                                if experiment_version.get("ai_scaffold_mode") == "multi_agent"
                                else None
                            ),
                        },
                    }
                ],
                current_user_id=user_id,
            )

            if not is_ai_mentioned:
                await _evaluate_shadow_prompt_candidates(
                    sio=sio,
                    project=project,
                    room_id=room_id,
                    current_user_id=user_id,
                    current_user_role=sender_actor_type,
                )
                
            if is_ai_mentioned:
                routing_context = _extract_routing_context(project, content) if project else {}
                # Trigger AI response in background
                # Use project_id as session_id to maintain context
                asyncio.create_task(
                    _process_ai_reply(
                        sio,
                        room_id,
                        project_id,
                        content,
                        project_id,
                        routing_context,
                        current_message_id=str(chat_log.id),
                    )
                )
            
        except Exception as e:
            logger.error(f"Error handling chat op for {room_id}: {e}")
