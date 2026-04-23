"""Activity logging service."""

from datetime import datetime
from typing import Optional

from app.repositories.activity_log import ActivityLog


class ActivityService:
    """Service for logging user activities."""

    @staticmethod
    async def log_activity(
        project_id: str,
        user_id: str,
        module: str,
        action: str,
        duration: int = 0,
        target_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> str:
        """Log a user activity with throttling for repetitive actions."""
        # For 'edit', 'view', 'update' actions, only log once every 30 minutes 
        # per user, module, and target (the 'one action per page/context' rule)
        from datetime import timedelta
        
        # Normalize action to catch variants like 'document_edit'
        base_action = action
        if "_" in action:
            parts = action.split("_")
            if parts[0] == module:
                base_action = parts[1]
            else:
                base_action = parts[-1]

        if base_action in ["edit", "view", "update", "active"]:
            # Check for recent identical activity
            recent_query = {
                "project_id": project_id,
                "user_id": user_id,
                "module": module,
                "action": action,
                "target_id": target_id,
                "timestamp": {"$gte": datetime.utcnow() - timedelta(minutes=30)}
            }
            count = await ActivityLog.find(recent_query).count()
            if count > 0:
                return "" # Throttled
                
        activity = ActivityLog(
            project_id=project_id,
            user_id=user_id,
            module=module,
            action=action,
            target_id=target_id,
            duration=duration,
            metadata=metadata,
            timestamp=datetime.utcnow(),
        )
        await activity.insert()

        return str(activity.id)

    @staticmethod
    async def log_batch_activities(activities: list) -> int:
        """Log multiple activities with selective throttling."""
        # Note: For simplicity in batch, we process them sequentially via log_activity
        # to ensure the throttling logic is applied consistently.
        # Use log_activity instead of insert_many for behavior-stream promoted events.
        count = 0
        for activity_data in activities:
            res = await ActivityService.log_activity(
                project_id=activity_data["project_id"],
                user_id=activity_data["user_id"],
                module=activity_data["module"],
                action=activity_data["action"],
                duration=activity_data.get("duration", 0),
                target_id=activity_data.get("target_id"),
                metadata=activity_data.get("metadata"),
            )
            if res:
                count += 1
        return count


activity_service = ActivityService()

