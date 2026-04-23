"""Analytics service for aggregating behavior data and calculating metrics."""

from datetime import datetime, timedelta, date
from typing import Dict, List, Optional, Any

from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import settings
from app.repositories.analytics_daily_stats import AnalyticsDailyStats
from app.repositories.dashboard_snapshot import DashboardSnapshot
from app.core.llm_config import get_llm
import hashlib
import json
import logging
from app.repositories.project import Project
from app.repositories.document import Document
from app.repositories.chat_log import ChatLog
from app.repositories.ai_message import AIMessage
from app.repositories.ai_conversation import AIConversation
from app.repositories.doc_comment import DocComment
from app.repositories.user import User
import bson

logger = logging.getLogger(__name__)


class AnalyticsService:
    """Service for analytics aggregation and calculation."""

    # Activity weights for weighted activity score
    ACTIVITY_WEIGHTS = {
        "edit": 1.0,
        "comment": 1.5,
        "upload": 2.0,
        "view": 0.5,
        "create": 1.2,
        "delete": 0.8,
        "update": 1.0,
    }

    # 4C Core Competencies weights
    COMMUNICATION_WEIGHTS = {
        "chat_messages": 0.3,
        "comments": 0.4,
        "document_edits": 0.3,
    }
    COLLABORATION_WEIGHTS = {
        "whiteboard_collaborations": 0.4,
        "resource_shares": 0.3,
        "task_collaborations": 0.3,
    }
    CRITICAL_THINKING_WEIGHTS = {
        "comment_quality": 0.5,
        "document_revisions": 0.5,
    }
    CREATIVITY_WEIGHTS = {
        "whiteboard_shapes": 0.5,
        "document_creations": 0.5,
    }

    @classmethod
    async def aggregate_daily_stats(
        cls,
        target_date: Optional[date] = None,
        project_id: Optional[str] = None,
    ) -> int:
        """Aggregate daily statistics for a specific date.

        Args:
            target_date: Date to aggregate (defaults to yesterday)
            project_id: Optional project ID to filter

        Returns:
            Number of stats records created
        """
        if target_date is None:
            target_date = (datetime.utcnow() - timedelta(days=1)).date()

        start_datetime = datetime.combine(target_date, datetime.min.time())
        end_datetime = datetime.combine(target_date, datetime.max.time())

        # Connect to MongoDB using shared instance
        from app.core.db.mongodb import mongodb
        db = mongodb.get_database()
        activity_logs_collection = db["activity_logs"]
        heartbeat_collection = db["heartbeat_stream"]

        # Build query
        query = {
            "timestamp": {
                "$gte": start_datetime,
                "$lte": end_datetime,
            }
        }
        if project_id:
            query["project_id"] = project_id

        # Aggregate active minutes from heartbeats
        heartbeat_query = {"timestamp": query["timestamp"]}
        if project_id:
            heartbeat_query["metadata.project_id"] = project_id
            
        heartbeat_pipeline = [
            {"$match": heartbeat_query},
            {
                "$group": {
                    "_id": {
                        "project_id": "$metadata.project_id",
                        "user_id": "$metadata.user_id",
                    },
                    "heartbeat_count": {"$sum": 1},
                }
            },
        ]

        heartbeat_results = await heartbeat_collection.aggregate(
            heartbeat_pipeline
        ).to_list(length=None)

        # Calculate active minutes (Each heartbeat = 30 seconds, so count * 0.5 = minutes)
        active_minutes_map = {}
        for result in heartbeat_results:
            p_id = result['_id']['project_id']
            u_id = result['_id']['user_id']
            if not p_id or not u_id: continue
            
            key = f"{p_id}:{u_id}"
            active_minutes_map[key] = int(result["heartbeat_count"] * 0.5 + 0.5) # Round up to nearest minute

        # Aggregate weighted activity score from activity_logs (Business events)
        activity_pipeline = [
            {"$match": query},
            {
                "$group": {
                    "_id": {
                        "project_id": "$project_id",
                        "user_id": "$user_id",
                        "action": "$action",
                    },
                    "count": {"$sum": 1},
                }
            },
        ]

        activity_results = await activity_logs_collection.aggregate(
            activity_pipeline
        ).to_list(length=None)

        # Aggregate weighted activity from behavior_stream (Raw events like 'view')
        # Map metadata fields to flat fields for easier processing
        behavior_query = {
            "timestamp": query["timestamp"]
        }
        if project_id:
            behavior_query["metadata.project_id"] = project_id
            
        behavior_pipeline = [
            {"$match": behavior_query},
            {
                "$group": {
                    "_id": {
                        "project_id": "$metadata.project_id",
                        "user_id": "$metadata.user_id",
                        "action": "$metadata.action",
                    },
                    "count": {"$sum": 1},
                }
            },
        ]
        
        behavior_results = await db["behavior_stream"].aggregate(behavior_pipeline).to_list(length=None)

        # Merge results into activity scores per user
        user_activity_map: Dict[str, Dict] = {}
        
        def process_results(results):
            for result in results:
                p_id = result["_id"]["project_id"]
                u_id = result["_id"]["user_id"]
                action = result["_id"]["action"]
                count = result["count"]

                key = f"{p_id}:{u_id}"
                if key not in user_activity_map:
                    user_activity_map[key] = {
                        "project_id": p_id,
                        "user_id": u_id,
                        "activity_breakdown": {},
                        "activity_score": 0.0,
                    }

                # Add to breakdown
                current_count = user_activity_map[key]["activity_breakdown"].get(action, 0)
                user_activity_map[key]["activity_breakdown"][action] = current_count + count
                
                # Add to weighted score
                weight = cls.ACTIVITY_WEIGHTS.get(action, 1.0)
                # Handle common prefixes in behavior actions (e.g. view_page_enter -> view)
                if action.startswith("view"):
                    weight = cls.ACTIVITY_WEIGHTS.get("view", 0.5)
                
                user_activity_map[key]["activity_score"] += count * weight

        process_results(activity_results)
        process_results(behavior_results)

        # Calculate 4C Core Competencies
        stats_records = []
        all_keys = set(user_activity_map.keys()) | set(active_minutes_map.keys())
        
        for key in all_keys:
            if ":" not in key: continue
            
            project_id, user_id = key.split(":")
            
            # Get data from maps
            data = user_activity_map.get(key, {
                "activity_score": 0.0,
                "activity_breakdown": {}
            })
            
            # Calculate 4C scores (simplified version)
            communication_score = await cls._calculate_communication_score(
                project_id, user_id, start_datetime, end_datetime
            )
            collaboration_score = await cls._calculate_collaboration_score(
                project_id, user_id, start_datetime, end_datetime
            )
            critical_thinking_score = await cls._calculate_critical_thinking_score(
                project_id, user_id, start_datetime, end_datetime
            )
            creativity_score = await cls._calculate_creativity_score(
                project_id, user_id, start_datetime, end_datetime
            )

            # Get active minutes
            active_minutes = active_minutes_map.get(key, 0)

            # Create or update daily stats
            stats = AnalyticsDailyStats(
                project_id=project_id,
                user_id=user_id,
                date=target_date,
                active_minutes=active_minutes,
                activity_score=data["activity_score"],
                activity_breakdown=data["activity_breakdown"],
                communication_score=communication_score,
                collaboration_score=collaboration_score,
                critical_thinking_score=critical_thinking_score,
                creativity_score=creativity_score,
            )

            # Check if record exists
            existing = await AnalyticsDailyStats.find_one(
                {
                    "project_id": project_id,
                    "user_id": user_id,
                    "date": target_date,
                }
            )

            if existing:
                # Update existing record
                existing.active_minutes = active_minutes
                existing.activity_score = data["activity_score"]
                existing.activity_breakdown = data["activity_breakdown"]
                existing.communication_score = communication_score
                existing.collaboration_score = collaboration_score
                existing.critical_thinking_score = critical_thinking_score
                existing.creativity_score = creativity_score
                existing.updated_at = datetime.utcnow()
                await existing.save()
            else:
                await stats.insert()

            stats_records.append(stats)

        return len(stats_records)

    @classmethod
    async def _calculate_communication_score(
        cls,
        project_id: str,
        user_id: str,
        start_datetime: datetime,
        end_datetime: datetime,
    ) -> float:
        """Calculate Communication score (0-100)."""
        from app.core.db.mongodb import mongodb
        db = mongodb.get_database()

        # Count chat messages
        chat_count = await db["chat_logs"].count_documents(
            {
                "project_id": project_id,
                "user_id": user_id,
                "created_at": {"$gte": start_datetime, "$lte": end_datetime},
            }
        )

        # Count comments
        comments_count = await db["doc_comments"].count_documents(
            {
                "created_by": user_id,
                "created_at": {"$gte": start_datetime, "$lte": end_datetime},
            }
        )

        # Count document edits
        doc_edits_count = await db["activity_logs"].count_documents(
            {
                "project_id": project_id,
                "user_id": user_id,
                "module": "document",
                "action": "edit",
                "timestamp": {"$gte": start_datetime, "$lte": end_datetime},
            }
        )

        # Calculate weighted score
        score = (
            chat_count * cls.COMMUNICATION_WEIGHTS["chat_messages"]
            + comments_count * cls.COMMUNICATION_WEIGHTS["comments"]
            + doc_edits_count * cls.COMMUNICATION_WEIGHTS["document_edits"]
        )

        # Normalize to 0-100 (simple normalization)
        normalized_score = min(100.0, score * 2.0)

        return normalized_score

    @classmethod
    async def _calculate_collaboration_score(
        cls,
        project_id: str,
        user_id: str,
        start_datetime: datetime,
        end_datetime: datetime,
    ) -> float:
        """Calculate Collaboration score (0-100)."""
        from app.core.db.mongodb import mongodb
        db = mongodb.get_database()

        # Count whiteboard collaborations (edits when others are online)
        whiteboard_collabs = await db["activity_logs"].count_documents(
            {
                "project_id": project_id,
                "user_id": user_id,
                "module": "whiteboard",
                "action": "edit",
                "timestamp": {"$gte": start_datetime, "$lte": end_datetime},
            }
        )

        # Count resource shares
        resource_shares = await db["activity_logs"].count_documents(
            {
                "project_id": project_id,
                "user_id": user_id,
                "module": "resource",
                "action": "upload",
                "timestamp": {"$gte": start_datetime, "$lte": end_datetime},
            }
        )

        # Count task collaborations
        task_collabs = await db["activity_logs"].count_documents(
            {
                "project_id": project_id,
                "user_id": user_id,
                "module": "task",
                "action": {"$in": ["create", "update"]},
                "timestamp": {"$gte": start_datetime, "$lte": end_datetime},
            }
        )

        # Calculate weighted score
        score = (
            whiteboard_collabs * cls.COLLABORATION_WEIGHTS["whiteboard_collaborations"]
            + resource_shares * cls.COLLABORATION_WEIGHTS["resource_shares"]
            + task_collabs * cls.COLLABORATION_WEIGHTS["task_collaborations"]
        )

        # Normalize to 0-100
        normalized_score = min(100.0, score * 1.5)

        return normalized_score

    @classmethod
    async def _calculate_critical_thinking_score(
        cls,
        project_id: str,
        user_id: str,
        start_datetime: datetime,
        end_datetime: datetime,
    ) -> float:
        """Calculate Critical Thinking score (0-100)."""
        from app.core.db.mongodb import mongodb
        db = mongodb.get_database()

        # Calculate comment quality (average comment length)
        comments = await db["doc_comments"].find(
            {
                "created_by": user_id,
                "created_at": {"$gte": start_datetime, "$lte": end_datetime},
            }
        ).to_list(length=None)

        avg_comment_length = 0.0
        if comments:
            total_length = sum(
                len(msg.get("content", "")) for c in comments for msg in c.get("messages", [])
            )
            avg_comment_length = total_length / len(comments)

        # Count document revisions
        doc_revisions = await db["activity_logs"].count_documents(
            {
                "project_id": project_id,
                "user_id": user_id,
                "module": "document",
                "action": "edit",
                "timestamp": {"$gte": start_datetime, "$lte": end_datetime},
            }
        )

        # Calculate weighted score
        comment_quality_score = min(100.0, avg_comment_length / 10.0)  # Normalize
        score = (
            comment_quality_score * cls.CRITICAL_THINKING_WEIGHTS["comment_quality"]
            + min(100.0, doc_revisions * 5.0)
            * cls.CRITICAL_THINKING_WEIGHTS["document_revisions"]
        )

        return min(100.0, score)

    @classmethod
    async def _calculate_creativity_score(
        cls,
        project_id: str,
        user_id: str,
        start_datetime: datetime,
        end_datetime: datetime,
    ) -> float:
        """Calculate Creativity score (0-100)."""
        from app.core.db.mongodb import mongodb
        db = mongodb.get_database()

        # Count whiteboard shapes created
        whiteboard_shapes = await db["activity_logs"].count_documents(
            {
                "project_id": project_id,
                "user_id": user_id,
                "module": "whiteboard",
                "action": "create",
                "timestamp": {"$gte": start_datetime, "$lte": end_datetime},
            }
        )

        # Count document creations
        doc_creations = await db["documents"].count_documents(
            {
                "project_id": project_id,
                "last_modified_by": user_id,
                "created_at": {"$gte": start_datetime, "$lte": end_datetime},
            }
        )

        # Calculate weighted score
        score = (
            whiteboard_shapes * cls.CREATIVITY_WEIGHTS["whiteboard_shapes"]
            + doc_creations * cls.CREATIVITY_WEIGHTS["document_creations"]
        )

        # Normalize to 0-100
        normalized_score = min(100.0, score * 10.0)
        return normalized_score

    @classmethod
    async def get_daily_stats(
        cls,
        project_id: str,
        user_id: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> List[AnalyticsDailyStats]:
        """Get daily statistics for a project/user.

        Args:
            project_id: The project ID
            user_id: Optional user ID to filter
            start_date: Start date
            end_date: End date

        Returns:
            List of daily stats
        """
        query = {"project_id": project_id}
        if user_id:
            query["user_id"] = user_id
        if start_date:
            query["date"] = {"$gte": start_date}
        if end_date:
            if "date" in query and isinstance(query["date"], dict):
                query["date"]["$lte"] = end_date
            else:
                query["date"] = {"$lte": end_date}

        stats = await AnalyticsDailyStats.find(query).sort("date").to_list()
        return stats

    @classmethod
    async def _extract_keywords(cls, title: str, content: str) -> List[str]:
        """Use LLM to extract key concepts from document content."""
        if not content and not title:
            return []
        
        try:
            llm = await get_llm(temperature=0)
            # Use a mix of title and a bit of content
            text_to_analyze = f"Title: {title}\nContent: {content[:500]}"
            prompt = f"""Extract 3-5 key academic concepts or keywords from the following document. 
Return ONLY a comma-separated list of keywords. 
Document:
{text_to_analyze}
Keywords:"""
            
            response = await llm.ainvoke(prompt)
            raw_keywords = response.content if hasattr(response, "content") else str(response)
            keywords = [k.strip() for k in raw_keywords.split(",") if k.strip()][:5]
            return keywords
        except Exception as e:
            print(f"Keyword extraction error: {e}")
            return []

    @classmethod
    async def get_knowledge_graph(cls, project_id: str, user_id: Optional[str] = None) -> Dict:
        """
        Generate a semantic knowledge graph from overall collaborative content.
        Supports dual-layered metrics for group and personal knowledge acquisition.
        """
        # 0. Get Project metadata for Seed Nodes
        project = await Project.get(project_id)
        project_meta = {
            "name": project.name if project else "",
            "description": project.description if project else "",
            "subtitle": project.subtitle if project else ""
        }
        
        # 1. Gather all collaborative text context
        # Documents
        docs = await Document.find({"project_id": project_id}).to_list()
        doc_texts = [f"Doc: {d.title} - {d.preview_text or ''}" for d in docs]
        
        # User specific content (for personal weights)
        personal_context = ""
        if user_id:
            # Filter docs modified by this user
            user_docs = [d for d in docs if d.last_modified_by == user_id]
            personal_context += "\n".join([f"My Doc: {d.title} - {d.preview_text or ''}" for d in user_docs])
        
        doc_text = "\n".join(doc_texts)
        
        # Chat Messages (Recent 50)
        chats = await ChatLog.find({"project_id": project_id}).sort("-created_at").limit(50).to_list()
        chat_text = "\n".join([f"Chat: {c.content}" for c in chats])
        
        # AI Tutor Conversations (Recent 20 messages)
        ai_convs = await AIConversation.find({"project_id": project_id}).to_list()
        ai_conv_ids = [str(c.id) for c in ai_convs]
        
        all_ai_msgs = await AIMessage.find({"conversation_id": {"$in": ai_conv_ids}}).sort("-created_at").to_list()
        
        if user_id:
            user_ai_msgs = [m for m in all_ai_msgs if m.role == "user" and m.user_id == user_id]
            personal_context += "\n" + "\n".join([f"My AI Query: {m.content}" for m in user_ai_msgs[:20]])

        ai_text = "\n".join([f"AI Dialog: {m.content}" for m in all_ai_msgs[:20]])
        
        # Comments
        comments = await DocComment.find({"document_id": {"$in": [str(d.id) for d in docs]}}).limit(20).to_list()
        comment_text = ""
        for comm in comments:
            msg_role = "Comment"
            for msg in comm.messages:
                content = msg.get('content', '')
                comment_text += f"\n{msg_role}: {content}"
                if user_id and msg.get('user_id') == user_id:
                    personal_context += f"\nMy Comment: {content}"

        full_context = f"{doc_text}\n{chat_text}\n{ai_text}\n{comment_text}"
        
        # 2. Extract Semantic Concepts and Relationships using LLM
        if not full_context.strip():
            return {
                "nodes": [{"id": "init", "label": "开始探索", "group": 1}],
                "links": []
            }

        try:
            llm = await get_llm(temperature=0.2)
            prompt = f"""Analyze the collaborative learning project:
Project Title: {project_meta['name']}
Description: {project_meta['description']}

Task:
1. Identify 3-4 "Seed Concepts" that form the foundation of this project based on its title and description.
2. Identify 8-12 "Discovered Concepts" from the recent collaboration context provided below.
3. Establish semantic relationships (links) between these concepts.

Rules:
- Seed concepts must have "is_seed": true.
- Use simple, noun-based labels in Chinese.
- Return a JSON object with "nodes" and "links".

Context:
{full_context[:3000]}

JSON Output Format:
{{
  "nodes": [
    {{"id": "c1", "label": "核心概念", "is_seed": true}},
    {{"id": "c2", "label": "发现概念", "is_seed": false}}
  ],
  "links": [
    {{"source": "c1", "target": "c2", "value": 1}}
  ]
}}
"""
            
            response = await llm.ainvoke(prompt)
            raw_text = response.content if hasattr(response, "content") else str(response)
            
            if "```json" in raw_text:
                raw_text = raw_text.split("```json")[1].split("```")[0].strip()
            elif "```" in raw_text:
                raw_text = raw_text.split("```")[1].strip()
            
            graph_data = json.loads(raw_text)
            nodes = graph_data.get("nodes", [])
            links = graph_data.get("links", [])
            
            # 3. Calculate weights based on mentions in context
            # Convert context to lower case for case-insensitive matching
            full_context_lower = full_context.lower()
            personal_context_lower = personal_context.lower()
            
            for node in nodes:
                label = node.get("label", "").lower()
                if not label: continue
                
                # Group value: frequency in full context
                # Simple count of occurrences
                group_mentions = full_context_lower.count(label)
                # Normalize (base 1 + mentions, min-max-ish)
                node["group_value"] = min(20, 1 + group_mentions)
                
                # Personal value: frequency in personal context
                if user_id:
                    personal_mentions = personal_context_lower.count(label)
                    node["personal_value"] = min(20, personal_mentions)
                else:
                    node["personal_value"] = 0

            # 4. Refine link values based on co-occurrence in context
            # This makes the line thickness meaningful
            context_blocks = full_context_lower.split('\n')
            for link in links:
                source_id = link.get("source")
                target_id = link.get("target")
                
                s_node = next((n for n in nodes if n["id"] == source_id), None)
                t_node = next((n for n in nodes if n["id"] == target_id), None)
                
                if s_node and t_node:
                    s_label = s_node.get("label", "").lower()
                    t_label = t_node.get("label", "").lower()
                    if s_label and t_label:
                        co_occur = sum(1 for block in context_blocks if s_label in block and t_label in block)
                        # Scale value to 1.0 - 5.0 range
                        link["value"] = 1.0 + min(4.0, co_occur * 0.5)
                    else:
                        link["value"] = 1.0
                else:
                    link["value"] = 1.0

            return {"nodes": nodes, "links": links}
            
        except Exception as e:
            logger.error(f"Failed to generate semantic knowledge graph: {e}")
            keyword_nodes = []
            keywords = await cls._extract_keywords("Collaboration Summary", full_context[:1000])
            for kw in keywords:
                keyword_nodes.append({"id": kw, "label": kw, "group": 1})
            return {"nodes": keyword_nodes, "links": []}

    @classmethod
    async def get_interaction_network(cls, project_id: str) -> Dict:
        """Generate an interaction network for the project members."""
        project = await Project.get(project_id)
        if not project:
            return {"nodes": [], "links": []}
            
        nodes = []
        user_ids = [member["user_id"] for member in project.members]
        
        # Fetch actual user data to get usernames
        users = await User.find({"_id": {"$in": [bson.ObjectId(uid) for uid in user_ids if bson.ObjectId.is_valid(uid)]}}).to_list()
        user_name_map = {str(u.id): u.username or u.email.split('@')[0] for u in users}

        for member in project.members:
            uid = member["user_id"]
            nodes.append({
                "id": uid,
                "label": user_name_map.get(uid, uid),  # Use real username, fallback to ID
                "role": member["role"]
            })
        
        # Add AI Node
        nodes.append({
            "id": "ai_assistant",
            "label": "AI 助手",
            "role": "ai"
        })
            
        # Calculate real weights based on interactions
        links = []
        from app.repositories.chat_log import ChatLog
        from app.repositories.doc_comment import DocComment
        from app.repositories.ai_conversation import AIConversation
        from app.repositories.ai_message import AIMessage

        # Fetch AI conversations for this project
        ai_convs = await AIConversation.find({"project_id": project_id}).to_list()
        ai_conv_ids = [str(c.id) for c in ai_convs]

        # 1. Peer-to-Peer interactions
        for i in range(len(nodes)):
            for j in range(i + 1, len(nodes)):
                u1 = nodes[i]["id"]
                u2 = nodes[j]["id"]
                
                if u1 == "ai_assistant" or u2 == "ai_assistant":
                    continue

                u1_chats = await ChatLog.find({"project_id": project_id, "user_id": u1}).count()
                u2_chats = await ChatLog.find({"project_id": project_id, "user_id": u2}).count()
                weight = 1.0 + min(4.0, (u1_chats + u2_chats) * 0.05)
                links.append({"source": u1, "target": u2, "weight": weight})

        # 2. User-to-AI interactions
        for i in range(len(nodes)):
            u_id = nodes[i]["id"]
            if u_id == "ai_assistant":
                continue
                
            # Count user's AI queries in this project context
            ai_query_count = await AIMessage.find({
                "conversation_id": {"$in": ai_conv_ids},
                "user_id": u_id,
                "role": "user"
            }).count()
            
            if ai_query_count > 0:
                # Slightly higher base weight for AI to make it prominent
                weight = 1.2 + min(3.8, ai_query_count * 0.4)
                links.append({
                    "source": u_id,
                    "target": "ai_assistant",
                    "weight": weight
                })
                
        return {"nodes": nodes, "links": links}

    @classmethod
    async def _generate_ai_suggestions(cls, scores: Dict[str, float], activity_summary: Dict[str, Any]) -> List[Dict]:
        """Generate personalized learning suggestions using LLM."""
        try:
            llm = await get_llm(temperature=0.7)
            
            # Enrich context for the AI
            breakdown_str = json.dumps(activity_summary.get("activity_breakdown", {}), indent=2)
            active_time = activity_summary.get("total_active_minutes", 0)
            
            prompt = f"""
            As an AI learning analytics expert, generate 3 specific, constructive, and personalized learning suggestions for a student in a collaborative project.
            
            Student Performance Data (Last 7 Days):
            1. Cor Competency Scores (0-100):
               - Communication: {scores.get('communication', 0):.1f}
               - Collaboration: {scores.get('collaboration', 0):.1f}
               - Critical Thinking: {scores.get('critical_thinking', 0):.1f}
               - Creativity: {scores.get('creativity', 0):.1f}
               
            2. Behavioral Activity:
               - Total Active Time: {active_time} minutes
               - Activity Breakdown:
               {breakdown_str}
            
            Guidelines:
            - Analyze the 4C scores and activity patterns to identify strengths and weaknesses.
            - Provide actionable advice (e.g., "Try initiating a whiteboard session" instead of just "Collaborate more").
            - Tone should be encouraging and professional.
            - If scores are high, suggest advanced challenges.
            - IMPORTANT: Output MUST BE IN CHINESE (Simplified Chinese).
            - The 'content' field must be in Chinese.
            - The 'title' field must be in Chinese.
            
            Return ONLY a JSON array of objects (no markdown, no explanations) with this structure:
            [
                {{
                    "id": "s1",
                    "title": "Short Title",
                    "content": "Detailed suggestion content...",
                    "type": "important" | "critical" | "info" | "normal"
                }}
            ]
            """
            
            response = await llm.ainvoke(prompt)
            content = response.content
            
            # Robust JSON parsing
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
                
            suggestions = json.loads(content.strip())
            
            # Ensure IDs are unique
            for i, s in enumerate(suggestions):
                s["id"] = f"ai_s{i}_{int(datetime.utcnow().timestamp())}"
                
            return suggestions
            
        except Exception as e:
            logger.error(f"Error generating AI suggestions: {e}")
            return []

    @classmethod
    async def get_learning_suggestions(cls, scores: Dict[str, float], activity_summary: Optional[Dict] = None) -> List[Dict]:
        """Generate learning suggestions based on 4C scores and behavior."""
        # 1. Try AI generation if summary is provided
        if activity_summary:
            ai_suggestions = await cls._generate_ai_suggestions(scores, activity_summary)
            if ai_suggestions:
                return ai_suggestions

        # 2. Fallback to rule-based logic
        suggestions = []
        
        # Logic based on scores
        if scores.get("communication", 0) < 60:
            suggestions.append({
                "id": "s1",
                "title": "提升沟通频率",
                "content": "检测到您的沟通评分较低，建议多在文档评论区或群聊中分享想法。",
                "type": "important"
            })
            
        if scores.get("collaboration", 0) < 60:
            suggestions.append({
                "id": "s2",
                "title": "加强团队协作",
                "content": "建议参与到其他成员创建的白板或文档中，共同编辑内容。",
                "type": "critical"
            })
            
        if scores.get("critical_thinking", 0) < 70:
            suggestions.append({
                "id": "s3",
                "title": "深度思考与反馈",
                "content": "在向他人提供反馈时，尝试提供更具建设性和深度评论。",
                "type": "normal"
            })
            
        if not suggestions:
            suggestions.append({
                "id": "s4",
                "title": "继续保持",
                "content": "您目前的各项能力发展均衡，请继续保持良好的学习状态。",
                "type": "info"
            })
            
        return suggestions

    @classmethod
    async def create_project_dashboard_snapshot(cls, project_id: str) -> Optional[DashboardSnapshot]:
        """Calculate and save a new dashboard snapshot for a project."""
        logger.info(f"Calculating dashboard snapshot for project: {project_id}")
        
        # 0. Trigger aggregation for TODAY for this project to ensure fresh data
        try:
            await cls.aggregate_daily_stats(target_date=datetime.utcnow().date(), project_id=project_id)
        except Exception as e:
            logger.error(f"Error triggering current day aggregation for project {project_id}: {e}")

        # 1. Fetch data (reusing existing methods)
        kg = await cls.get_knowledge_graph(project_id)
        network = await cls.get_interaction_network(project_id)
        
        # 2. Daily Stats & 4C
        end_date = datetime.utcnow().date()
        start_date = end_date - timedelta(days=7)
        daily_stats = await cls.get_daily_stats(project_id, start_date=start_date, end_date=end_date)
        
        # Summary & Activity Breakdown Aggregation
        total_breakdown = {}
        trend_map = {}
        
        for stat in daily_stats:
            # Aggregate breakdown
            for action, count in stat.activity_breakdown.items():
                total_breakdown[action] = total_breakdown.get(action, 0) + count
            
            # Aggregate Trend by Date (Project Level)
            date_str = stat.date.isoformat()
            if date_str not in trend_map:
                trend_map[date_str] = {
                    "date": date_str,
                    "active_minutes": 0,
                    "activity_score": 0,
                    "count": 0,
                    "communication": 0,
                    "collaboration": 0,
                    "critical_thinking": 0,
                    "creativity": 0
                }
            
            trend_map[date_str]["active_minutes"] += stat.active_minutes
            trend_map[date_str]["activity_score"] += stat.activity_score
            trend_map[date_str]["count"] += 1
            trend_map[date_str]["communication"] += stat.communication_score
            trend_map[date_str]["collaboration"] += stat.collaboration_score
            trend_map[date_str]["critical_thinking"] += stat.critical_thinking_score
            trend_map[date_str]["creativity"] += stat.creativity_score

        # Prepare activity_trend sorted by date
        activity_trend = sorted(
            [
                {
                    "date": d, 
                    "active_minutes": v["active_minutes"], 
                    "activity_score": v["activity_score"]
                } for d, v in trend_map.items()
            ], 
            key=lambda x: x["date"]
        )
        
        # Calculate persistent project 4C using EMA across the trend
        # This prevents scores from "zeroing out" on low activity days
        four_c = {"communication": 0, "collaboration": 0, "critical_thinking": 0, "creativity": 0}
        
        if activity_trend:
            # Sort full stats by date to apply EMA
            daily_project_averages = []
            for item in activity_trend:
                d_str = item["date"]
                m = trend_map[d_str]
                if m["count"] > 0:
                    daily_project_averages.append({
                        "communication": m["communication"] / m["count"],
                        "collaboration": m["collaboration"] / m["count"],
                        "critical_thinking": m["critical_thinking"] / m["count"],
                        "creativity": m["creativity"] / m["count"],
                    })
            
            # Apply EMA (alpha=0.3)
            alpha = 0.3
            if daily_project_averages:
                curr = daily_project_averages[0].copy()
                for i in range(1, len(daily_project_averages)):
                    for k in curr:
                        curr[k] = curr[k] * (1 - alpha) + daily_project_averages[i][k] * alpha
                four_c = curr

        summary = {
            "total_active_minutes": sum(s.active_minutes for s in daily_stats),
            "total_activity_score": sum(s.activity_score for s in daily_stats),
            "member_count": len(network["nodes"]),
            "activity_breakdown": total_breakdown
        }
        
        suggestions = await cls.get_learning_suggestions(four_c, activity_summary=summary)
        
        # 3. Create/Update Snapshot
        snapshot = await DashboardSnapshot.find_one({"project_id": project_id})
        if not snapshot:
            snapshot = DashboardSnapshot(project_id=project_id)
            
        snapshot.knowledge_graph = kg
        snapshot.interaction_network = network
        snapshot.learning_suggestions = suggestions
        snapshot.four_c = four_c
        snapshot.activity_trend = activity_trend
        snapshot.summary = summary
        snapshot.updated_at = datetime.utcnow()
        
        await snapshot.save()
        return snapshot

    @classmethod
    async def get_cached_dashboard_data(cls, project_id: str, background_tasks: Optional[Any] = None, user_id: Optional[str] = None) -> Optional[Dict]:
        """Retrieve the latest cached dashboard snapshot and optionally merge user specific stats."""
        snapshot = await DashboardSnapshot.find_one({"project_id": project_id})
        
        # If no cache or cache is older than 30 minutes, refresh it
        is_stale = snapshot and (datetime.utcnow() - snapshot.updated_at).total_seconds() > 1800
        
        if not snapshot:
            # Must block if no snapshot exists at all
            snapshot = await cls.create_project_dashboard_snapshot(project_id)
        elif is_stale and background_tasks:
            # Refresh in background if stale but we have old data to show
            background_tasks.add_task(cls.create_project_dashboard_snapshot, project_id)
            
        if not snapshot:
            return None
            
        result = {
            "four_c": snapshot.four_c,
            "activity_trend": snapshot.activity_trend,
            "knowledge_graph": snapshot.knowledge_graph,
            "interaction_network": snapshot.interaction_network,
            "learning_suggestions": snapshot.learning_suggestions,
            "summary": snapshot.summary,
            "last_updated": snapshot.updated_at.isoformat()
        }
        
        # 3. If user_id is provided, merge personal stats into the trend
        if user_id:
            end_date = datetime.utcnow().date()
            start_date = end_date - timedelta(days=7)
            personal_stats = await cls.get_daily_stats(project_id, user_id=user_id, start_date=start_date, end_date=end_date)
            
            personal_map = {s.date.isoformat(): s for s in personal_stats}
            
            # Merge into activity_trend
            new_trend = []
            for item in result["activity_trend"]:
                date_str = item["date"]
                p_stat = personal_map.get(date_str)
                new_item = {
                    **item,
                    "personal_active_minutes": p_stat.active_minutes if p_stat else 0,
                    "personal_activity_score": p_stat.activity_score if p_stat else 0.0
                }
                new_trend.append(new_item)
            
            result["activity_trend"] = new_trend
            
            # --- Personal Knowledge Graph Merging ---
            if "nodes" in result["knowledge_graph"]:
                # To get fresh personal mentions, we need the personal context
                # Reuse the gathering logic or simplified version
                # Documents
                user_docs = await Document.find({
                    "project_id": project_id,
                    "last_modified_by": user_id
                }).to_list()
                p_context = "\n".join([f"{d.title} {d.preview_text or ''}" for d in user_docs]).lower()
                
                # AI Messages
                ai_convs = await AIConversation.find({"project_id": project_id}).to_list()
                user_ai_msgs = await AIMessage.find({
                    "conversation_id": {"$in": [str(c.id) for c in ai_convs]},
                    "role": "user",
                    "user_id": user_id
                }).limit(30).to_list()
                p_context += " " + " ".join([m.content for m in user_ai_msgs]).lower()
                
                for node in result["knowledge_graph"]["nodes"]:
                    label = node.get("label", "").lower()
                    if label:
                        node["personal_value"] = min(20, p_context.count(label))
                    else:
                        node["personal_value"] = 0
            # ----------------------------------------
            
            # 4. Also calculate personal 4C using EMA
            personal_four_c = {"communication": 0, "collaboration": 0, "critical_thinking": 0, "creativity": 0}
            if personal_stats:
                # Sort by date
                sorted_p_stats = sorted(personal_stats, key=lambda x: x.date)
                alpha = 0.3
                curr = {
                    "communication": sorted_p_stats[0].communication_score,
                    "collaboration": sorted_p_stats[0].collaboration_score,
                    "critical_thinking": sorted_p_stats[0].critical_thinking_score,
                    "creativity": sorted_p_stats[0].creativity_score,
                }
                for i in range(1, len(sorted_p_stats)):
                    s = sorted_p_stats[i]
                    curr["communication"] = curr["communication"] * (1 - alpha) + s.communication_score * alpha
                    curr["collaboration"] = curr["collaboration"] * (1 - alpha) + s.collaboration_score * alpha
                    curr["critical_thinking"] = curr["critical_thinking"] * (1 - alpha) + s.critical_thinking_score * alpha
                    curr["creativity"] = curr["creativity"] * (1 - alpha) + s.creativity_score * alpha
                personal_four_c = curr
                
            result["personal_four_c"] = personal_four_c
            
        return result

    @classmethod
    async def update_all_dashboard_snapshots(cls):
        """Background task to update all active project snapshots."""
        from app.repositories.project import Project
        # Find projects active in the last 7 days or just all for now
        projects = await Project.find({"is_archived": False}).to_list()
        logger.info(f"Starting background update for {len(projects)} projects")
        
        for project in projects:
            try:
                await cls.create_project_dashboard_snapshot(str(project.id))
            except Exception as e:
                logger.error(f"Failed to update snapshot for project {project.id}: {e}")


analytics_service = AnalyticsService()

