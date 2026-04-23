"""Inquiry service for snapshot management."""

import zlib
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, Optional

from app.repositories.inquiry_snapshot import InquirySnapshot

logger = logging.getLogger(__name__)

class InquiryService:
    """Service for managing deep inquiry space snapshots."""

    _last_activity: Dict[str, datetime] = {}
    _last_snapshot: Dict[str, datetime] = {}
    _debounce_tasks: Dict[str, asyncio.Task] = {}

    DEBOUNCE_INTERVAL = timedelta(seconds=5)
    FORCE_SAVE_INTERVAL = timedelta(seconds=60)

    @classmethod
    async def save_snapshot(
        cls,
        project_id: str,
        snapshot_data: bytes,
        compress: bool = True,
    ) -> str:
        """Save inquiry space snapshot."""
        if not project_id:
            raise ValueError("project_id cannot be empty")
        if not snapshot_data:
            raise ValueError("snapshot_data cannot be empty")

        data_to_save = snapshot_data
        is_compressed = False
        
        if compress:
            try:
                compressed_data = zlib.compress(snapshot_data)
                if len(compressed_data) < len(snapshot_data):
                    data_to_save = compressed_data
                    is_compressed = True
            except Exception as e:
                logger.warning(f"Compression failed: {e}")

        try:
            latest_snapshots = (
                await InquirySnapshot.find({"project_id": project_id})
                .sort("-snapshot_version")
                .limit(1)
                .to_list()
            )
            latest = latest_snapshots[0] if latest_snapshots else None
            next_version = (latest.snapshot_version + 1) if latest else 1

            snapshot = InquirySnapshot(
                project_id=project_id,
                data=data_to_save,
                snapshot_version=next_version,
                compressed=is_compressed,
            )
            await snapshot.insert()
            
            cls._last_snapshot[project_id] = datetime.utcnow()
            logger.info(f"Saved inquiry snapshot for project {project_id} (version {next_version}, compressed={is_compressed})")
            return str(snapshot.id)
        except Exception as e:
            logger.error(f"Failed to save inquiry snapshot: {str(e)}")
            raise

    @classmethod
    async def load_latest_snapshot(cls, project_id: str) -> Optional[bytes]:
        """Load latest inquiry snapshot."""
        try:
            snapshots = (
                await InquirySnapshot.find({"project_id": project_id})
                .sort("-snapshot_version")
                .limit(1)
                .to_list()
            )
            snapshot = snapshots[0] if snapshots else None

            if snapshot:
                data = snapshot.data
                if getattr(snapshot, "compressed", False):
                    try:
                        data = zlib.decompress(data)
                    except Exception as e:
                        logger.error(f"Failed to decompress inquiry snapshot: {e}")
                        raise
                return data
            return None
        except Exception as e:
            logger.error(f"Failed to load inquiry snapshot: {str(e)}")
            raise

inquiry_service = InquiryService()
