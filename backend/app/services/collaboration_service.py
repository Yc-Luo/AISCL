"""Collaboration service for managing real-time collaboration snapshots."""

import asyncio
import logging
from typing import Optional, Dict

from app.repositories.collaboration_snapshot import CollaborationSnapshot

logger = logging.getLogger(__name__)

class CollaborationService:
    def __init__(self):
        self._debounce_tasks: Dict[str, asyncio.Task] = {}

    async def load_latest_snapshot(self, resource_id: str, snapshot_type: str = "whiteboard") -> Optional[bytes]:
        """
        Load the latest snapshot for a project/document and type.
        resource_id: project_id (for whiteboard/inquiry) or document_id (for docs)
        """
        logger.info(f"Loading snapshot for {resource_id} ({snapshot_type})")
        
        snapshot = await CollaborationSnapshot.get_latest(resource_id)
        if snapshot and snapshot.snapshot_data:
            return snapshot.snapshot_data.get("data")
        return None

    async def save_snapshot(self, resource_id: str, state: bytes, snapshot_type: str = "whiteboard"):
        """Save a snapshot for a specific resource (project, doc, etc)."""
        logger.info(f"Saving snapshot for {resource_id} ({snapshot_type}, {len(state)} bytes)")
        
        snapshot = CollaborationSnapshot(
            project_id=resource_id, # Reusing this field as generic resource ID
            snapshot_data={"data": state}
        )
        await snapshot.save()

    async def debounced_save(self, resource_id: str, state: bytes, snapshot_type: str = "whiteboard", wait: float = 2.0):
        """Debounce save operations."""
        key = f"{snapshot_type}:{resource_id}"
        
        if key in self._debounce_tasks:
            self._debounce_tasks[key].cancel()
            
        async def delayed_save():
            await asyncio.sleep(wait)
            try:
                await self.save_snapshot(resource_id, state, snapshot_type)
            except Exception as e:
                logger.error(f"Error in debounced save: {e}")
            finally:
                self._debounce_tasks.pop(key, None)

        self._debounce_tasks[key] = asyncio.create_task(delayed_save())


collaboration_service = CollaborationService()
