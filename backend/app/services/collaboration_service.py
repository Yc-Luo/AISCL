"""Collaboration service for managing real-time collaboration snapshots."""

import asyncio
import logging
from datetime import datetime
from typing import Optional, Dict

from app.repositories.collaboration_snapshot import CollaborationSnapshot
from app.repositories.document import Document

logger = logging.getLogger(__name__)

try:
    import y_py as Y
except ImportError:  # pragma: no cover - handled at runtime in deployments
    Y = None

class CollaborationService:
    def __init__(self):
        self._debounce_tasks: Dict[str, asyncio.Task] = {}
        self._merge_locks: Dict[str, asyncio.Lock] = {}

    async def load_latest_snapshot(self, resource_id: str, snapshot_type: str = "whiteboard") -> Optional[bytes]:
        """
        Load the latest snapshot for a project/document and type.
        resource_id: project_id (for whiteboard/inquiry) or document_id (for docs)
        """
        logger.info(f"Loading snapshot for {resource_id} ({snapshot_type})")
        
        if snapshot_type == "document":
            document = await Document.get(resource_id)
            return document.content_state if document and document.content_state else None

        snapshot = await CollaborationSnapshot.get_latest(resource_id)
        if snapshot and snapshot.snapshot_data:
            return snapshot.snapshot_data.get("data")
        return None

    async def save_snapshot(self, resource_id: str, state: bytes, snapshot_type: str = "whiteboard"):
        """Save a snapshot for a specific resource (project, doc, etc)."""
        logger.info(f"Saving snapshot for {resource_id} ({snapshot_type}, {len(state)} bytes)")

        if snapshot_type == "document":
            document = await Document.get(resource_id)
            if not document:
                logger.warning("Document snapshot target not found: %s", resource_id)
                return
            document.content_state = state
            document.updated_at = datetime.utcnow()
            await document.save()
            return
        
        snapshot = CollaborationSnapshot(
            project_id=resource_id, # Reusing this field as generic resource ID
            snapshot_data={"data": state}
        )
        await snapshot.save()

    async def merge_yjs_update(self, resource_id: str, update: bytes, snapshot_type: str = "document") -> None:
        """Merge one Yjs update into the canonical snapshot for a resource."""
        if not update:
            return
        if Y is None:
            logger.warning("Cannot merge Yjs update because y_py is unavailable")
            return

        key = f"{snapshot_type}:{resource_id}"
        lock = self._merge_locks.setdefault(key, asyncio.Lock())
        async with lock:
            current_state = await self.load_latest_snapshot(resource_id, snapshot_type)
            ydoc = Y.YDoc()
            try:
                if current_state:
                    try:
                        with ydoc.begin_transaction() as txn:
                            Y.apply_update(txn, current_state)
                    except TypeError:
                        Y.apply_update(ydoc, current_state)
                try:
                    with ydoc.begin_transaction() as txn:
                        Y.apply_update(txn, update)
                except TypeError:
                    Y.apply_update(ydoc, update)
                merged_state = Y.encode_state_as_update(ydoc)
                await self.save_snapshot(resource_id, merged_state, snapshot_type)
            except Exception as e:
                logger.error("Failed to merge Yjs update for %s:%s: %s", snapshot_type, resource_id, e, exc_info=True)

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
