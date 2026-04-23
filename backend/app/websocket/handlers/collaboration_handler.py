"""Collaboration handler for Socket.IO events (Whiteboard, Document, Inquiry)."""

import logging
from typing import Dict, Any, Optional
import base64

from app.core.db.mongodb import mongodb
from app.services.inquiry_service import inquiry_service
from app.repositories.document import Document
from app.repositories.collaboration_snapshot import CollaborationSnapshot

logger = logging.getLogger(__name__)

async def unload_resources(room_id: str):
    """
    Unload resources for a collaborative room.
    """
    logger.info(f"Unloading resources for room: {room_id}")
    # Placeholder for potential memory cleanup or final sync check
    pass

async def sync_yjs_state(sio, sid, room_id: str, module: str):
    """
    Trigger synchronization of Yjs state for a joining user.
    """
    logger.info(f"Syncing Yjs state for user {sid} in room {room_id} (module: {module})")
    
    state_data: Optional[bytes] = None
    
    try:
        if module == "inquiry":
            # Extract clean project ID for DB query
            project_id = room_id.replace("inquiry:", "")
            from app.services.inquiry_service import inquiry_service
            state_data = await inquiry_service.load_latest_snapshot(project_id)
        elif module == "document":
            doc_id = room_id.replace("doc:", "")
            from app.repositories.document import Document
            doc = await Document.get(doc_id)
            state_data = doc.content_state if doc else None
        
        if state_data:
            # Base64 encode for transmission
            encoded_state = base64.b64encode(state_data).decode("utf-8")
            await sio.emit('room-state', {
                'roomId': room_id,
                'module': module,
                'state': encoded_state,
                'isInitial': True
            }, room=sid)
            logger.info(f"[Sync] Sent authoritative state to {sid} for room {room_id}")
        else:
            # Fallback for new empty rooms
            await sio.emit('sync_ready', {'room_id': room_id, 'module': module}, room=sid)
            
    except Exception as e:
        logger.error(f"[Sync Error] Failed to sync state for {room_id}: {e}")
        await sio.emit('sync_ready', {'room_id': room_id, 'module': module}, room=sid)

async def handle_collaboration_op(sio, sid, data: Dict[str, Any], user_id: str, module: str = "whiteboard"):
    """
    Handle general collaboration operations (Yjs awareness, updates, etc).
    Modules: whiteboard, document, inquiry
    """
    # Broadcast to room
    room_id = data.get("room_id") or data.get("roomId")
    if not room_id:
        logger.warning(f"Collaboration op from {user_id} has no room_id: {data}")
        return

    # Ensure prefix consistency if module is known
    # Note: frontend usually sends with prefix, but let's be robust
    if module == "inquiry" and not room_id.startswith("inquiry:"):
        room_id = f"inquiry:{room_id}"
    elif module == "document" and not room_id.startswith("doc:"):
        room_id = f"doc:{room_id}"
    elif (module == "whiteboard" or module == "collaboration") and not room_id.startswith("project:"):
        room_id = f"project:{room_id}"

    # Get members for debugging
    try:
        # In python-socketio async server, rooms are managed in the manager
        # This is a bit internal but useful for debugging
        participants = sio.manager.get_participants("/", room_id)
        participant_count = 0
        for _ in participants:
            participant_count += 1
        
        logger.info(f"Op from {user_id} (sid: {sid}) in {room_id} (module: {module}). Room participants: {participant_count}")
    except Exception:
        logger.info(f"Op from {user_id} in {room_id} (module: {module})")
    
    # CRITICAL: Ensure data.roomId matches the prefixed room_id for frontend matching
    data["roomId"] = room_id
    
    # Broadcast as a unified operation to support SyncService on the frontend
    await sio.emit("operation", data, room=room_id, skip_sid=sid)
