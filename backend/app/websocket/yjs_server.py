"""Y.js WebSocket server for real-time collaboration using ypy-websocket."""

import logging
import asyncio
from typing import Dict, Tuple
from fastapi import WebSocket, WebSocketDisconnect, Query, status

from app.services.auth_service import verify_token
from app.services.room_mapping_service import validate_room_access
from app.services.collaboration_service import collaboration_service

# ypy-websocket integration
try:
    import y_py as Y
    from ypy_websocket.websocket_server import YRoom
except ImportError:
    YRoom = None
    Y = None

# Setup logging
logger = logging.getLogger(__name__)

class FastAPIWebsocketAdapter:
    """Adapter to make FastAPI WebSocket compatible with ypy-websocket."""
    def __init__(self, websocket: WebSocket):
        self._ws = websocket

    async def send(self, message: bytes):
        await self._ws.send_bytes(message)

    async def recv(self) -> bytes:
        try:
            return await self._ws.receive_bytes()
        except WebSocketDisconnect:
            raise StopAsyncIteration()

    @property
    def path(self):
        return ""

    @property
    def query(self):
        return ""
    
    @property
    def headers(self):
        return {}


# Store active YRooms
rooms: Dict[str, YRoom] = {}
room_connection_counts: Dict[str, int] = {}
room_observers: Dict[str, object] = {}
rooms_lock = asyncio.Lock()


def parse_room_name(room_name: str) -> Tuple[str, str]:
    """Parse room name to get snapshot type and project ID."""
    if room_name.startswith("wb:"):
        return "whiteboard", room_name[3:]
    elif room_name.startswith("doc:"):
        return "document", room_name[4:]
    elif room_name.startswith("inquiry:"):
        return "inquiry", room_name[8:]
    else:
        return "whiteboard", room_name


async def load_room_data(room: YRoom, room_name: str):
    """Load initial room data from database."""
    snapshot_type, project_id = parse_room_name(room_name)

    try:
        data = await collaboration_service.load_latest_snapshot(project_id, snapshot_type)
        if data:
            logger.info(f"Loaded snapshot for {room_name} ({len(data)} bytes)")
            try:
                # Apply update to YDoc using transaction
                with room.ydoc.begin_transaction() as t:
                    Y.apply_update(t, data)
            except Exception as e:
                # Try simple apply if transaction/signature differs
                Y.apply_update(room.ydoc, data)
    except Exception as e:
        logger.error(f"Failed to load snapshot for {room_name}: {e}")


def setup_persistence(room: YRoom, room_name: str):
    """Setup persistence listener for the room."""
    snapshot_type, project_id = parse_room_name(room_name)

    def on_update(event):
        try:
            state = Y.encode_state_as_update(room.ydoc)
            if state and len(state) > 0:
                asyncio.create_task(
                    collaboration_service.debounced_save(project_id, state, snapshot_type)
                )
                logger.debug(f"Queued persistence for {room_name} ({len(state)} bytes)")
            else:
                logger.warning(f"Empty state update for {room_name}, skipping persistence")
        except Exception as e:
            logger.error(f"Persistence error for {room_name}: {str(e)}")

    observer = room.ydoc.observe_after_transaction(on_update)
    if observer:
        room_observers[room_name] = observer
    logger.info(f"Persistence setup completed for room: {room_name}")


async def get_or_create_room(room_name: str) -> YRoom:
    """Create or reuse a YRoom and track active websocket sessions."""
    async with rooms_lock:
        room = rooms.get(room_name)
        if room is None:
            room = YRoom()
            await load_room_data(room, room_name)
            setup_persistence(room, room_name)
            rooms[room_name] = room
            logger.info("Created new YRoom: %s", room_name)

        room_connection_counts[room_name] = room_connection_counts.get(room_name, 0) + 1
        return room


def cleanup_room(room: YRoom, room_name: str) -> None:
    """Best-effort cleanup for an unused YRoom."""
    observer = room_observers.pop(room_name, None)
    for method_name in ("unsubscribe", "dispose", "cancel"):
        method = getattr(observer, method_name, None)
        if callable(method):
            try:
                method()
            except Exception as exc:  # noqa: BLE001
                logger.debug("YRoom observer cleanup failed for %s: %s", room_name, exc)
            break

    for target in (room, getattr(room, "ydoc", None)):
        destroy = getattr(target, "destroy", None)
        if callable(destroy):
            try:
                destroy()
            except Exception as exc:  # noqa: BLE001
                logger.debug("YRoom cleanup hook failed for %s: %s", room_name, exc)


async def release_room(room_name: str, room: YRoom) -> None:
    """Release one websocket session and evict the room when idle."""
    async with rooms_lock:
        remaining = max(room_connection_counts.get(room_name, 1) - 1, 0)
        if remaining > 0:
            room_connection_counts[room_name] = remaining
            return

        room_connection_counts.pop(room_name, None)
        if rooms.get(room_name) is room:
            rooms.pop(room_name, None)
            cleanup_room(room, room_name)
            logger.info("Released idle YRoom: %s", room_name)


async def websocket_endpoint(websocket: WebSocket, room_name: str, token: str = Query(None)):
    """Y.js WebSocket endpoint with authentication and persistence."""

    if YRoom is None:
        logger.error("ypy-websocket dependency missing for room: %s", room_name)
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        return

    # Authenticate user
    if not token:
        logger.warning("WebSocket connection attempt without token for room: %s", room_name)
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        payload = verify_token(token, token_type="access")
        if not payload:
            logger.warning("Invalid token for room: %s", room_name)
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        user_id = payload.get("sub")
        if not user_id:
            logger.warning("Token missing user_id for room: %s", room_name)
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        logger.info("User %s authenticated for room: %s", user_id, room_name)
    except Exception as e:
        logger.error("Authentication error for room %s: %s", room_name, str(e))
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # Validate room access
    try:
        has_access = await validate_room_access(room_name, user_id)
        if not has_access:
            logger.warning("Access denied for user %s to room: %s", user_id, room_name)
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        logger.debug("Access granted for user %s to room: %s", user_id, room_name)
    except Exception as e:
        logger.error("Error validating room access for user %s to room %s: %s", user_id, room_name, str(e))
        await websocket.close(code=status.WS_1003_UNSUPPORTED_DATA)
        return

    # Accept WebSocket connection
    try:
        await websocket.accept()
        logger.info("WebSocket connection established for user %s in room: %s", user_id, room_name)
    except Exception as e:
        logger.error("Failed to accept WebSocket connection for user %s in room %s: %s", user_id, room_name, str(e))
        return

    room = await get_or_create_room(room_name)
    snapshot_type, project_id = parse_room_name(room_name)
    
    adapter = FastAPIWebsocketAdapter(websocket)
    try:
        await room.serve(adapter)
    except Exception as e:
        if not isinstance(e, StopAsyncIteration):
            logger.warning(f"WebSocket session ended for room {room_name}: {e}")
    finally:
        # Save state on disconnect to ensure data is captured immediately
        # Bypassing debounce to prevent data loss on page refresh
        try:
            state = Y.encode_state_as_update(room.ydoc)
            await collaboration_service.save_snapshot(project_id, state, snapshot_type)
            logger.info(f"Saved immediate snapshot on disconnect for {room_name}")
        except Exception as e:
            logger.error(f"Failed to save snapshot on disconnect for {room_name}: {e}")
        await release_room(room_name, room)
