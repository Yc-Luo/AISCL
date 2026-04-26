import logging
# from app.repositories.chat_log import ChatLog # Avoid circular imports if any, but should be fine
# Dynamic import inside function is safer if we are not sure about initialization order
import datetime
import asyncio
import re
import time
import uuid
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

ROLE_MENTION_MAP = {
    "@资料研究员": "evidence_researcher",
    "@观点挑战者": "viewpoint_challenger",
    "@反馈追问者": "feedback_prompter",
    "@问题推进者": "problem_progressor",
}

GENERAL_AI_MENTIONS = {
    "@AISCL",
    "@AI",
    "@AI智能助手",
    "@智能助手",
    "@智能体",
    "@智能导师",
}

ROLE_KEY_TO_SUBAGENT = {
    "cognitive_support": "evidence_researcher",
    "viewpoint_challenge": "viewpoint_challenger",
    "feedback_prompting": "feedback_prompter",
    "problem_progression": "problem_progressor",
}

AUTO_GROUP_PROMPT_RULE_TYPES = {
    "evidence_gap",
    "counterargument_missing",
    "revision_stall",
}

RULE_TYPE_TO_SUBAGENT = {
    "evidence_gap": "evidence_researcher",
    "counterargument_missing": "viewpoint_challenger",
    "revision_stall": "feedback_prompter",
    "responsibility_risk": "problem_progressor",
}

SUBAGENT_LABELS = {
    "evidence_researcher": "资料研究员",
    "viewpoint_challenger": "观点挑战者",
    "feedback_prompter": "反馈追问者",
    "problem_progressor": "问题推进者",
}


def _utc_iso_timestamp() -> str:
    """Return an ISO timestamp that browsers unambiguously parse as UTC."""
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")

STAGE_LABELS = {
    "task_import": "任务导入",
    "problem_planning": "问题规划",
    "evidence_exploration": "证据探究",
    "argumentation": "论证协商",
    "reflection_revision": "反思修订",
}

RULE_TYPE_LABELS = {
    "evidence_gap": "证据不足",
    "counterargument_missing": "反驳缺失",
    "revision_stall": "修订停滞",
    "responsibility_risk": "责任风险",
}

AUTO_PROMPT_SENDER_IDS = {
    "evidence_researcher": "auto_prompt:evidence_researcher",
    "viewpoint_challenger": "auto_prompt:viewpoint_challenger",
    "feedback_prompter": "auto_prompt:feedback_prompter",
    "problem_progressor": "auto_prompt:problem_progressor",
}

THINK_BLOCK_PATTERN = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
MAX_CHAT_MESSAGE_CHARS = 1000
MAX_CHAT_MENTIONS = 20
MAX_CHAT_FILENAME_CHARS = 255


def _detect_preferred_subagent(content: str) -> str | None:
    for mention, subagent in ROLE_MENTION_MAP.items():
        if mention in content:
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
    enabled_roles = experiment_version.get("enabled_scaffold_roles") or []
    enabled_subagents = [
        ROLE_KEY_TO_SUBAGENT[role]
        for role in enabled_roles
        if role in ROLE_KEY_TO_SUBAGENT
    ]
    return {
        "project_id": str(getattr(project, "id", "")) if project else None,
        "experiment_version_id": experiment_version.get("version_name") or experiment_version.get("name"),
        "current_stage": experiment_version.get("current_stage"),
        "ai_scaffold_mode": experiment_version.get("ai_scaffold_mode"),
        "process_scaffold_mode": experiment_version.get("process_scaffold_mode"),
        "enabled_scaffold_roles": enabled_roles,
        "enabled_subagents": enabled_subagents,
        "preferred_subagent": _detect_preferred_subagent(content),
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
    live_group_prompt_enabled = intervention_service.is_group_chat_live_enabled(enabled_rule_set)

    for intervention in matched_interventions:
        rule_type = intervention.get("rule_type")
        if not rule_type:
            continue

        policy = await research_event_service.evaluate_shadow_prompt_policy(
            project_id=str(project.id),
            rule_type=rule_type,
            stage_id=current_stage,
            online_learner_count=online_learner_count,
            cooldown_minutes=10,
            observation_window_minutes=5,
            auto_rule_types=AUTO_GROUP_PROMPT_RULE_TYPES,
        )
        if not policy.get("should_record"):
            continue

        recommended_subagent = RULE_TYPE_TO_SUBAGENT.get(rule_type)
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
                    "enabled_rule_set": enabled_rule_set,
                    "online_learner_count": online_learner_count,
                    "cooldown_minutes": 10,
                    "observation_window_minutes": 5,
                    "window_bucket": policy.get("window_bucket"),
                    "previous_window_bucket": policy.get("previous_window_bucket"),
                    "consecutive_window_count": policy.get("consecutive_window_count", 0),
                    "recommended_subagent": recommended_subagent,
                    "recommended_role_label": SUBAGENT_LABELS.get(recommended_subagent),
                    "recommended_message": intervention.get("message"),
                    "intervention_context": intervention_context,
                    "shadow_mode": True,
                },
            }
        )

        if (
            live_group_prompt_enabled
            and policy.get("would_send")
            and live_prompt_candidate is None
        ):
            recommended_subagent = RULE_TYPE_TO_SUBAGENT.get(rule_type)
            live_prompt_candidate = {
                "project_id": str(project.id),
                "experiment_version_id": experiment_version_id,
                "room_id": room_id,
                "group_id": room_id,
                "stage_id": current_stage,
                "rule_type": rule_type,
                "rule_name": intervention.get("rule_name"),
                "recommended_subagent": recommended_subagent,
                "recommended_role_label": SUBAGENT_LABELS.get(recommended_subagent, "AISCL智能助手"),
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
    role_label = prompt_data.get("recommended_role_label") or "AISCL智能助手"
    message = prompt_data.get("message") or "请继续推进当前协作任务。"
    sender_id = AUTO_PROMPT_SENDER_IDS.get(recommended_subagent, "auto_prompt:assistant")
    prompt_text = f"【{role_label}提示】{message}"
    ai_meta = {
        "primary_agent": role_label,
        "rationale_summary": f"依据当前协作状态与规则命中，本轮由{role_label}向小组发出短提示。",
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
        metadata={"ai_meta": ai_meta},
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


async def _process_ai_reply(sio, room_id, project_id, user_content, session_id, routing_context=None):
    """Process AI response in background and broadcast."""
    typing_started = False
    try:
        from app.services.agents.agent_service import agent_service
        from app.services.agents.deep_agents_shim import derive_routing_decision_from_context
        from app.services.ai_service import ai_service
        from app.services.rag_service import rag_service
        from app.repositories.project import Project
        from app.repositories.chat_log import ChatLog
        from app.services.activity_service import activity_service
        
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
        ai_scaffold_mode = experiment_version.get("ai_scaffold_mode") or (routing_context or {}).get("ai_scaffold_mode")
        # Using project_id as session_id for continuity within the project
        graph_context = {
            **(routing_context or {}),
            "project_id": project_id,
            "room_id": room_id,
            "source_actor_type": "ai_assistant",
        }
        ai_user_id = "ai_assistant"
        message_id = str(uuid.uuid4())
        message_timestamp = _utc_iso_timestamp()
        last_emit_time = 0.0
        routing_decision = {}
        ai_meta = {
            "primary_agent": "AI智能助手",
            "rationale_summary": "当前班级采用单 AI 模式，本轮由通用 AI 助手直接回应。",
            "routing_summary": [
                "AI模式：单AI直接回复",
                "编排方式：不经过多智能体 graph 路由",
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
            context = None
            try:
                context = await rag_service.retrieve_context(
                    project_id,
                    user_content,
                    max_results=3,
                    group_id=room_id,
                    stage_id=experiment_version.get("current_stage"),
                    actor_type="ai_assistant",
                )
            except Exception as exc:
                logger.warning("Group chat single-AI RAG unavailable: %s", exc)

            async for chunk in ai_service.chat_stream(
                project_id=project_id,
                user_id=ai_user_id,
                message=user_content,
                role_id=None,
                conversation_id=None,
                context=context,
                category="group_chat",
                message_metadata={"ai_meta": ai_meta},
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

            async for chunk in agent_service.chat_stream(
                persona_key="supervisor", # Entry point
                message=user_content,
                session_id=session_id,
                context=graph_context,
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

        final_response = _sanitize_stream_display_content(full_response)

        if not final_response:
            return

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
            },
        )
        await chat_log.insert()
        
        # Log activity
        await activity_service.log_activity(
            project_id=project_id,
            user_id=ai_user_id,
            module="chat",
            action="reply",
            metadata={"length": len(final_response)}
        )

        if final_response != displayed_response:
            await emit_partial(final_response)
        
    except Exception as e:
        logger.error(f"Error processing AI reply: {e}")
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
    
    if not room_id or not op_payload:
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
            experiment_version = getattr(project, "experiment_version", None) if project else None
            current_stage = experiment_version.get("current_stage") if experiment_version else None
            experiment_version_id = (
                experiment_version.get("version_name") or experiment_version.get("name")
                if experiment_version
                else None
            )
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
            ai_keywords = list(ROLE_MENTION_MAP.keys()) + list(GENERAL_AI_MENTIONS)
            if not is_ai_mentioned and any(k in content for k in ai_keywords):
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
                            "preferred_subagent": _detect_preferred_subagent(content),
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
                    _process_ai_reply(sio, room_id, project_id, content, project_id, routing_context)
                )
            
        except Exception as e:
            logger.error(f"Error handling chat op for {room_id}: {e}")
