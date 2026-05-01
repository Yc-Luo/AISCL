"""Service for research-mode event recording and retrieval."""

from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from app.repositories.project import Project
from app.repositories.research_event import ResearchEvent


SPECIAL_CHAT_SENDERS = {
    "system": {
        "username": "System",
        "role": "system",
        "actor_type": "system",
    },
    "ai_assistant": {
        "username": "AISCL智能助手",
        "role": "ai_assistant",
        "actor_type": "ai_assistant",
    },
    "auto_prompt:evidence_researcher": {
        "username": "资料研究员",
        "role": "ai_assistant",
        "actor_type": "ai_assistant",
    },
    "auto_prompt:viewpoint_challenger": {
        "username": "观点挑战者",
        "role": "ai_assistant",
        "actor_type": "ai_assistant",
    },
    "auto_prompt:feedback_prompter": {
        "username": "反馈追问者",
        "role": "ai_assistant",
        "actor_type": "ai_assistant",
    },
    "auto_prompt:problem_progressor": {
        "username": "问题推进者",
        "role": "ai_assistant",
        "actor_type": "ai_assistant",
    },
}


class ResearchEventService:
    """Service for research-mode event operations."""

    LSA_EVENT_SYMBOLS = {
        "peer_message_send": "peer_msg",
        "peer_image_send": "peer_media",
        "learning_stage_enter": "stage_enter",
        "learning_stage_transition": "stage_shift",
        "node_add": "node_add",
        "node_content_commit": "node_edit",
        "node_type_update": "node_retype",
        "node_delete": "node_delete",
        "edge_add": "edge_add",
        "edge_relation_toggle": "edge_relate",
        "edge_delete": "edge_delete",
        "evidence_source_bind": "evidence_bind",
        "evidence_source_open": "evidence_open",
        "shared_record_content_commit": "record_commit",
        "shared_record_annotation_create": "annotation_create",
        "shared_record_annotation_reply": "annotation_reply",
        "scaffold_rule_check_request": "rule_check",
        "scaffold_rule_check_result": "rule_result",
        "scaffold_rule_recommendation_accept": "rule_accept",
        "wiki_item_created": "wiki_create",
        "wiki_item_updated": "wiki_update",
        "wiki_item_deleted": "wiki_delete",
        "wiki_item_quoted": "wiki_quote",
        "retrieval_requested": "rag_query",
        "citation_attached": "rag_cite",
    }

    @staticmethod
    def normalize_event(event_data: Dict[str, Any], current_user_id: Optional[str]) -> Dict[str, Any]:
        """Normalize event payload before persistence."""
        normalized = dict(event_data)
        if normalized.get("user_id") is None:
            actor_type = normalized.get("actor_type")
            if actor_type != "system" and current_user_id:
                normalized["user_id"] = current_user_id
        normalized["event_time"] = normalized.get("event_time") or datetime.utcnow()
        normalized["payload"] = normalized.get("payload") or {}
        return normalized

    @staticmethod
    async def record_batch_events(
        events: List[Dict[str, Any]],
        current_user_id: Optional[str],
    ) -> int:
        """Persist a batch of research events."""
        if not events:
            return 0

        documents = [
            ResearchEvent(**ResearchEventService.normalize_event(event, current_user_id))
            for event in events
        ]
        await ResearchEvent.insert_many(documents)
        return len(documents)

    @staticmethod
    async def build_intervention_context_from_events(
        project_id: str,
        stage_id: Optional[str] = None,
        lookback_minutes: int = 20,
        pending_peer_message_count: int = 0,
    ) -> Dict[str, Any]:
        """Build minimal intervention context from recent research events."""
        now = datetime.utcnow()
        query: Dict[str, Any] = {
            "project_id": project_id,
            "event_time": {"$gte": now - timedelta(minutes=lookback_minutes)},
        }
        if stage_id:
            query["stage_id"] = stage_id

        events = await ResearchEvent.find(query).sort("event_time").to_list()

        evidence_node_add_count = 0
        evidence_source_bind_count = 0
        counter_argument_count = 0
        recent_revision_count = 0
        last_revision_time: Optional[datetime] = None
        student_dialogue_count = pending_peer_message_count
        ai_support_count = 0
        first_event_time = events[0].event_time if events else None

        for event in events:
            payload = event.payload or {}

            if event.event_type == "node_add":
                node_type = payload.get("node_type")
                if node_type == "evidence":
                    evidence_node_add_count += 1
                elif node_type == "counter-argument":
                    counter_argument_count += 1

            elif event.event_type == "node_type_update":
                to_type = payload.get("to_type")
                if to_type == "evidence":
                    evidence_node_add_count += 1
                elif to_type == "counter-argument":
                    counter_argument_count += 1

            elif event.event_type == "evidence_source_bind":
                evidence_source_bind_count += 1

            elif event.event_type in {"node_content_commit", "shared_record_content_commit"}:
                recent_revision_count += 1
                if not last_revision_time or event.event_time > last_revision_time:
                    last_revision_time = event.event_time

            elif event.event_type == "peer_message_send":
                student_dialogue_count += 1

            if event.event_domain == "scaffold" and event.actor_type in {"ai_assistant", "ai_tutor"}:
                ai_support_count += 1

        evidence_node_count = max(evidence_node_add_count, evidence_source_bind_count)
        total_interaction_count = student_dialogue_count + ai_support_count
        ai_assistance_ratio = (
            ai_support_count / total_interaction_count
            if total_interaction_count > 0
            else None
        )
        session_elapsed_seconds = (
            int((now - first_event_time).total_seconds())
            if first_event_time
            else 0
        )

        return {
            "evidence_node_count": evidence_node_count,
            "counter_argument_count": counter_argument_count,
            "recent_revision_count": recent_revision_count,
            "last_revision_time": last_revision_time,
            "session_elapsed_seconds": session_elapsed_seconds,
            "ai_assistance_ratio": ai_assistance_ratio,
        }

    @staticmethod
    async def evaluate_shadow_prompt_policy(
        project_id: str,
        rule_type: str,
        current_time: Optional[datetime] = None,
        stage_id: Optional[str] = None,
        online_learner_count: int = 0,
        cooldown_minutes: int = 10,
        observation_window_minutes: int = 5,
        auto_rule_types: Optional[set[str]] = None,
    ) -> Dict[str, Any]:
        """Evaluate whether a matched rule would produce an auto prompt in shadow mode."""
        now = current_time or datetime.utcnow()
        window_seconds = observation_window_minutes * 60
        current_bucket = int(now.timestamp() // window_seconds)
        previous_bucket = current_bucket - 1

        base_query: Dict[str, Any] = {
            "project_id": project_id,
            "event_domain": "scaffold",
            "event_type": "shadow_prompt_candidate",
            "payload.rule_type": rule_type,
        }
        if stage_id:
            base_query["stage_id"] = stage_id

        existing_current_bucket = await ResearchEvent.find_one(
            {
                **base_query,
                "payload.window_bucket": current_bucket,
            }
        )
        if existing_current_bucket:
            return {
                "should_record": False,
                "window_bucket": current_bucket,
                "previous_window_bucket": previous_bucket,
                "consecutive_window_count": 0,
                "would_send": False,
                "block_reason": "already_recorded_current_window",
            }

        previous_bucket_hit = await ResearchEvent.find_one(
            {
                **base_query,
                "payload.window_bucket": previous_bucket,
                "payload.matched": True,
            }
        )
        consecutive_window_count = 2 if previous_bucket_hit else 1

        recent_send_matches = await ResearchEvent.find(
            {
                **base_query,
                "payload.would_send": True,
                "event_time": {"$gte": now - timedelta(minutes=cooldown_minutes)},
            }
        ).sort("-event_time").limit(1).to_list()
        recent_send = recent_send_matches[0] if recent_send_matches else None

        would_send = True
        block_reason: Optional[str] = None

        if auto_rule_types is not None and rule_type not in auto_rule_types:
            would_send = False
            block_reason = "rule_not_auto_prompted"
        elif online_learner_count <= 0:
            would_send = False
            block_reason = "no_online_learners"
        elif recent_send:
            would_send = False
            block_reason = "cooldown_active"
        elif consecutive_window_count < 2:
            would_send = False
            block_reason = "insufficient_consecutive_windows"

        return {
            "should_record": True,
            "window_bucket": current_bucket,
            "previous_window_bucket": previous_bucket,
            "consecutive_window_count": consecutive_window_count,
            "would_send": would_send,
            "block_reason": block_reason,
        }

    @staticmethod
    async def get_events_by_project(
        project_id: str,
        skip: int = 0,
        limit: int = 100,
        event_domain: Optional[str] = None,
        group_id: Optional[str] = None,
        stage_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> tuple[List[ResearchEvent], int]:
        """Get research events by project with optional filters."""
        query: Dict[str, Any] = {
            "project_id": project_id,
            "metadata.teacher_help_request": {"$ne": True},
            "metadata.teacher_private_reply": {"$ne": True},
        }
        if event_domain:
            query["event_domain"] = event_domain
        if group_id:
            query["group_id"] = group_id
        if stage_id:
            query["stage_id"] = stage_id
        if start_date or end_date:
            query["event_time"] = {}
            if start_date:
                query["event_time"]["$gte"] = start_date
            if end_date:
                query["event_time"]["$lte"] = end_date

        events = (
            await ResearchEvent.find(query)
            .sort("-event_time")
            .skip(skip)
            .limit(limit)
            .to_list()
        )
        total = await ResearchEvent.find(query).count()
        return events, total

    @staticmethod
    async def export_group_stage_features(
        project_id: str,
        experiment_version_id: Optional[str] = None,
        group_id: Optional[str] = None,
        stage_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Aggregate minimal group-stage features for downstream analysis."""
        query: Dict[str, Any] = {"project_id": project_id}
        if experiment_version_id:
            query["experiment_version_id"] = experiment_version_id
        if group_id:
            query["group_id"] = group_id
        if stage_id:
            query["stage_id"] = stage_id

        events = await ResearchEvent.find(query).sort("event_time").to_list()
        grouped: Dict[tuple[str, str, str], Dict[str, Any]] = {}

        count_fields = {
            "node_add": "node_add_count",
            "edge_add": "edge_add_count",
            "evidence_source_bind": "evidence_source_bind_count",
            "evidence_source_open": "evidence_source_open_count",
            "shared_record_content_commit": "shared_record_content_commit_count",
            "shared_record_annotation_create": "shared_record_annotation_create_count",
            "shared_record_annotation_reply": "shared_record_annotation_reply_count",
            "scaffold_rule_check_request": "scaffold_rule_check_request_count",
            "scaffold_rule_check_result": "scaffold_rule_check_result_count",
            "scaffold_rule_recommendation_accept": "scaffold_rule_recommendation_accept_count",
            "learning_stage_enter": "stage_transition_count",
            "learning_stage_transition": "stage_transition_count",
        }

        for event in events:
            normalized_stage = event.stage_id or "unassigned"
            normalized_group_id = event.group_id
            normalized_group_key = normalized_group_id or f"project:{project_id}"
            key = (
                event.experiment_version_id or "default",
                normalized_group_key,
                normalized_stage,
            )

            if key not in grouped:
                grouped[key] = {
                    "project_id": project_id,
                    "experiment_version_id": event.experiment_version_id,
                    "group_id": normalized_group_id,
                    "group_key": normalized_group_key,
                    "stage_id": normalized_stage,
                    "event_count": 0,
                    "actors": set(),
                    "first_event_time": event.event_time,
                    "last_event_time": event.event_time,
                    "node_add_count": 0,
                    "edge_add_count": 0,
                    "evidence_source_bind_count": 0,
                    "evidence_source_open_count": 0,
                    "shared_record_content_commit_count": 0,
                    "shared_record_annotation_create_count": 0,
                    "shared_record_annotation_reply_count": 0,
                    "scaffold_rule_check_request_count": 0,
                    "scaffold_rule_check_result_count": 0,
                    "scaffold_rule_recommendation_accept_count": 0,
                    "stage_transition_count": 0,
                }

            row = grouped[key]
            row["event_count"] += 1
            if event.user_id:
                row["actors"].add(event.user_id)
            row["last_event_time"] = event.event_time

            count_field = count_fields.get(event.event_type)
            if count_field:
                row[count_field] += 1

        rows: List[Dict[str, Any]] = []
        for row in grouped.values():
            first_event_time = row.pop("first_event_time")
            last_event_time = row.pop("last_event_time")
            actors = row.pop("actors")
            active_span_seconds = None
            if first_event_time and last_event_time:
                active_span_seconds = max(
                    (last_event_time - first_event_time).total_seconds(),
                    0.0,
                )
            row["unique_actor_count"] = len(actors)
            row["active_span_seconds"] = active_span_seconds
            rows.append(row)

        rows.sort(
            key=lambda item: (
                item.get("experiment_version_id") or "",
                item.get("group_key") or "",
                item.get("stage_id") or "",
            )
        )
        return rows

    @classmethod
    async def export_lsa_ready_sequences(
        cls,
        project_id: str,
        experiment_version_id: Optional[str] = None,
        group_id: Optional[str] = None,
        stage_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Export time-ordered event sequences for LSA/HMM preparation."""
        query: Dict[str, Any] = {"project_id": project_id}
        if experiment_version_id:
            query["experiment_version_id"] = experiment_version_id
        if group_id:
            query["group_id"] = group_id
        if stage_id:
            query["stage_id"] = stage_id

        events = await ResearchEvent.find(query).sort("event_time").to_list()
        rows: List[Dict[str, Any]] = []
        sequence_counters: Dict[tuple[str, str, str], int] = {}

        for event in events:
            event_symbol = cls.LSA_EVENT_SYMBOLS.get(event.event_type)
            if not event_symbol:
                continue

            normalized_stage = event.stage_id or "unassigned"
            normalized_group_key = event.group_id or f"project:{project_id}"
            key = (
                event.experiment_version_id or "default",
                normalized_group_key,
                normalized_stage,
            )
            current_index = sequence_counters.get(key, 0) + 1
            sequence_counters[key] = current_index

            rows.append(
                {
                    "project_id": project_id,
                    "experiment_version_id": event.experiment_version_id,
                    "group_id": event.group_id,
                    "group_key": normalized_group_key,
                    "stage_id": normalized_stage,
                    "sequence_index": current_index,
                    "actor_type": event.actor_type,
                    "event_time": event.event_time,
                    "event_domain": event.event_domain,
                    "event_type": event.event_type,
                    "event_symbol": event_symbol,
                }
            )

        return rows

    @staticmethod
    async def _resolve_users(user_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """Resolve user labels for export rows."""
        import bson

        from app.repositories.user import User

        object_ids = [
            bson.ObjectId(user_id)
            for user_id in set(user_ids)
            if bson.ObjectId.is_valid(user_id)
        ]
        if not object_ids:
            return {}

        users = await User.find({"_id": {"$in": object_ids}}).to_list()
        return {
            str(user.id): {
                "username": user.username or user.email,
                "email": str(user.email),
                "role": user.role,
            }
            for user in users
        }

    @classmethod
    async def export_group_chat_transcripts(
        cls,
        project_id: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 20000,
    ) -> Dict[str, Any]:
        """Export full group-chat transcripts for qualitative checks and discourse analysis."""
        from app.repositories.chat_log import ChatLog

        query: Dict[str, Any] = {"project_id": project_id}
        if start_date:
            query["created_at"] = {"$gte": start_date}
        if end_date:
            if "created_at" in query:
                query["created_at"]["$lte"] = end_date
            else:
                query["created_at"] = {"$lte": end_date}

        messages = await ChatLog.find(query).sort("created_at").limit(limit).to_list()
        total = await ChatLog.find(query).count()

        user_ids = [
            message.user_id
            for message in messages
            if message.user_id not in SPECIAL_CHAT_SENDERS
        ]
        users = await cls._resolve_users(user_ids)

        rows: List[Dict[str, Any]] = []
        for index, message in enumerate(messages, start=1):
            metadata = message.metadata or {}
            ai_meta = metadata.get("ai_meta") if isinstance(metadata, dict) else None
            special_sender = SPECIAL_CHAT_SENDERS.get(message.user_id)
            user_info = users.get(message.user_id, {})
            username = (
                special_sender.get("username")
                if special_sender
                else user_info.get("username", "Unknown")
            )
            user_role = (
                special_sender.get("role")
                if special_sender
                else user_info.get("role")
            )
            actor_type = (
                special_sender.get("actor_type")
                if special_sender
                else ("teacher" if user_role == "teacher" else "student")
            )
            routing_summary = []
            if isinstance(ai_meta, dict):
                routing_summary = ai_meta.get("routing_summary") or []

            rows.append(
                {
                    "id": str(message.id),
                    "project_id": message.project_id,
                    "group_id": message.project_id,
                    "sequence_index": index,
                    "user_id": message.user_id,
                    "username": username,
                    "user_role": user_role,
                    "actor_type": actor_type,
                    "message_type": message.message_type,
                    "content": message.content,
                    "content_length": len(message.content or ""),
                    "mentions": message.mentions,
                    "mention_count": len(message.mentions or []),
                    "client_message_id": metadata.get("client_message_id") if isinstance(metadata, dict) else None,
                    "primary_agent": ai_meta.get("primary_agent") if isinstance(ai_meta, dict) else None,
                    "rationale_summary": ai_meta.get("rationale_summary") if isinstance(ai_meta, dict) else None,
                    "routing_summary": routing_summary,
                    "ai_meta": ai_meta,
                    "created_at": message.created_at,
                }
            )

        return {"messages": rows, "total": total}

    @classmethod
    async def export_ai_tutor_transcripts(
        cls,
        project_id: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 20000,
    ) -> Dict[str, Any]:
        """Export full AI tutor transcripts across project conversations."""
        from app.repositories.ai_conversation import AIConversation
        from app.repositories.ai_message import AIMessage

        conversations = (
            await AIConversation.find({"project_id": project_id, "category": "chat"})
            .sort("created_at")
            .to_list()
        )
        conversation_map = {str(conversation.id): conversation for conversation in conversations}
        if not conversation_map:
            return {"messages": [], "total": 0}

        message_query: Dict[str, Any] = {"conversation_id": {"$in": list(conversation_map.keys())}}
        if start_date:
            message_query["created_at"] = {"$gte": start_date}
        if end_date:
            if "created_at" in message_query:
                message_query["created_at"]["$lte"] = end_date
            else:
                message_query["created_at"] = {"$lte": end_date}

        messages = await AIMessage.find(message_query).sort("created_at").limit(limit).to_list()
        total = await AIMessage.find(message_query).count()
        users = await cls._resolve_users([conversation.user_id for conversation in conversations])

        turn_counters: Dict[str, int] = {}
        rows: List[Dict[str, Any]] = []
        for message in messages:
            conversation = conversation_map.get(message.conversation_id)
            if not conversation:
                continue

            current_turn = turn_counters.get(message.conversation_id, 0) + 1
            turn_counters[message.conversation_id] = current_turn

            user_info = users.get(conversation.user_id, {})
            metadata = message.metadata or {}
            ai_meta = metadata.get("ai_meta") if isinstance(metadata, dict) else None
            processing_summary = []
            if isinstance(ai_meta, dict):
                processing_summary = ai_meta.get("processing_summary") or []

            rows.append(
                {
                    "project_id": conversation.project_id,
                    "conversation_id": message.conversation_id,
                    "conversation_title": conversation.title,
                    "conversation_user_id": conversation.user_id,
                    "username": user_info.get("username", "Unknown"),
                    "user_role": user_info.get("role"),
                    "persona_id": conversation.persona_id,
                    "category": conversation.category,
                    "message_id": str(message.id),
                    "message_role": message.role,
                    "turn_index": current_turn,
                    "content": message.content,
                    "content_length": len(message.content or ""),
                    "citation_count": len(message.citations or []),
                    "citations": message.citations,
                    "primary_view": ai_meta.get("primary_view") if isinstance(ai_meta, dict) else None,
                    "rationale_summary": ai_meta.get("rationale_summary") if isinstance(ai_meta, dict) else None,
                    "processing_summary": processing_summary,
                    "ai_meta": ai_meta,
                    "message_created_at": message.created_at,
                    "conversation_created_at": conversation.created_at,
                    "conversation_updated_at": conversation.updated_at,
                }
            )

        rows.sort(
            key=lambda row: (
                row["conversation_created_at"],
                row["conversation_id"],
                row["turn_index"],
            )
        )
        return {"messages": rows, "total": total}

    @staticmethod
    async def get_project_health_snapshot(project_id: str) -> Dict[str, Any]:
        """Build a minimal health snapshot for one project's research-mode data."""
        events = await ResearchEvent.find({"project_id": project_id}).sort("-event_time").to_list()
        project = await Project.get(project_id)
        event_domain_counts: Counter[str] = Counter()
        key_event_counts: Counter[str] = Counter()
        stages = set()
        experiment_versions = set()

        key_events = {
            "learning_stage_enter",
            "learning_stage_transition",
            "node_add",
            "shared_record_content_commit",
            "scaffold_rule_check_request",
            "scaffold_rule_check_result",
            "scaffold_rule_recommendation_accept",
            "evidence_source_bind",
            "evidence_source_open",
        }

        for event in events:
            event_domain_counts[event.event_domain] += 1
            if event.event_type in key_events:
                key_event_counts[event.event_type] += 1
            if event.stage_id:
                stages.add(event.stage_id)
            if event.experiment_version_id:
                experiment_versions.add(event.experiment_version_id)

        if project and getattr(project, "experiment_version", None):
            experiment_version = project.experiment_version
            version_name = experiment_version.get("version_name") or experiment_version.get("name")
            if version_name:
                experiment_versions.add(version_name)
            current_stage = experiment_version.get("current_stage")
            if current_stage:
                stages.add(current_stage)
            stage_sequence = experiment_version.get("stage_sequence") or []
            stages.update(stage for stage in stage_sequence if stage)

        return {
            "project_id": project_id,
            "experiment_version_count": len(experiment_versions),
            "research_event_count": len(events),
            "stage_count": len(stages),
            "has_scaffold_events": event_domain_counts.get("scaffold", 0) > 0,
            "has_inquiry_events": event_domain_counts.get("inquiry_structure", 0) > 0,
            "has_shared_record_events": event_domain_counts.get("shared_record", 0) > 0,
            "has_stage_events": event_domain_counts.get("stage_transition", 0) > 0,
            "has_rule_accept_events": key_event_counts.get("scaffold_rule_recommendation_accept", 0) > 0,
            "last_event_time": events[0].event_time if events else None,
            "event_domain_counts": dict(event_domain_counts),
            "key_event_counts": dict(key_event_counts),
        }


research_event_service = ResearchEventService()
