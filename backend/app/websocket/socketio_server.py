import json
import logging
from typing import Dict, Optional, Any

from socketio import AsyncServer, ASGIApp
from socketio.exceptions import ConnectionRefusedError

from app.core.config import settings
from app.services.auth_service import verify_token
from app.services.room_mapping_service import validate_room_access
from app.websocket.handlers.collaboration_handler import unload_resources

# Create Socket.IO server
sio = AsyncServer(
    cors_allowed_origins=settings.CORS_ORIGINS,
    async_mode="asgi",
    ping_timeout=60,
    ping_interval=25,
    compression=True,
)

logger = logging.getLogger(__name__)

MAX_BATCH_OPERATIONS = 100
MAX_OPERATION_PAYLOAD_CHARS = 250_000
MAX_BATCH_PAYLOAD_CHARS = 1_000_000

# Store user connections: {user_id: [sid1, sid2, ...]}
user_connections: Dict[str, list] = {}
# Store room members: {room_id: {user_id: sid}}
room_members: Dict[str, Dict[str, str]] = {}


def normalize_room_id(room_id: str, module: Optional[str] = None) -> str:
    """Normalize client room IDs before permission checks and broadcasts."""
    if room_id.startswith(("project:", "doc:", "wb:", "inquiry:")):
        return room_id
    if module == "inquiry":
        return f"inquiry:{room_id}"
    if module == "document":
        return f"doc:{room_id}"
    if module in {"whiteboard", "collaboration"}:
        # Socket.IO collaboration handlers route whiteboard/project operations through
        # project-scoped rooms. The wb: prefix is reserved for Yjs websocket rooms.
        return f"project:{room_id}"
    return f"project:{room_id}"


async def ensure_room_access(user_id: str, room_id: str) -> bool:
    """Validate Socket.IO room access and keep denial logging in one place."""
    has_access = await validate_room_access(room_id, user_id)
    if not has_access:
        logger.warning("Socket room access denied: user_id=%s room_id=%s", user_id, room_id)
    return has_access


async def authenticate_socket(auth: Optional[dict]) -> Optional[str]:
    """Authenticate socket connection using JWT token."""
    if not auth or "token" not in auth:
        return None

    token = auth["token"]
    payload = verify_token(token, token_type="access")
    if not payload:
        return None

    user_id = payload.get("sub")
    return user_id


def _payload_size_chars(payload: Any) -> int:
    """Estimate JSON payload size before dispatching WebSocket operations."""
    try:
        return len(json.dumps(payload, ensure_ascii=False, default=str))
    except Exception:  # noqa: BLE001
        return len(str(payload))


@sio.event
async def connect(sid, environ, auth):
    """Handle client connection with authentication."""
    user_id = await authenticate_socket(auth)
    if not user_id:
        raise ConnectionRefusedError("Authentication failed")

    # Store connection
    if user_id not in user_connections:
        user_connections[user_id] = []
    user_connections[user_id].append(sid)

    # Store user info in session
    await sio.save_session(sid, {"user_id": user_id})
    print(f"Client connected: {sid}, user_id: {user_id}")


@sio.event
async def disconnect(sid, *args):
    """Handle client disconnection."""
    session = await sio.get_session(sid)
    user_id = session.get("user_id")

    if user_id:
        # Remove from user connections
        if user_id in user_connections:
            if sid in user_connections[user_id]:
                user_connections[user_id].remove(sid)
            if not user_connections[user_id]:
                del user_connections[user_id]

        # Remove from all rooms
        # Leave all rooms and clean up room_members
        for room_id, members in list(room_members.items()):
            if user_id in members and members[user_id] == sid:
                # Remove user from room
                del members[user_id]
                logger.info(f"User {user_id} removed from room {room_id}")

                # Notify others
                await sio.emit(
                    "user_left",
                    {"roomId": room_id, "user_id": user_id},
                    room=room_id,
                )

                # If room is empty, remove it from the index
                if not members:
                    # Use pop to avoid KeyError in async race conditions
                    room_members.pop(room_id, None)
                    logger.info(f"Room {room_id} closed as it is now empty")
                    # Unload heavy resources
                    from app.websocket.handlers.collaboration_handler import unload_resources
                    await unload_resources(room_id)

    logger.info(f"Client disconnected: {sid}, user_id: {user_id}")


@sio.event
async def join_room(sid, data):
    """Join a project room."""
    logger.info(f"[join_room] sid={sid}, data={data}")
    
    session = await sio.get_session(sid)
    user_id = session.get("user_id")
    if not user_id:
        logger.warning(f"[join_room] No user_id in session for {sid}")
        return

    room_id = data.get("room_id") or data.get("room") or data.get("roomId")
    if not room_id:
        logger.warning(f"[join_room] No room_id in data for {sid}")
        return

    # Extract module to help formatting
    module = data.get("module")

    room_id = normalize_room_id(room_id, module)
    if not await ensure_room_access(user_id, room_id):
        await sio.emit(
            "room_join_error",
            {"room": room_id, "message": "No permission to join this room"},
            room=sid,
        )
        return

    await sio.enter_room(sid, room_id)
    logger.info(f"[join_room] User {user_id} joined room {room_id}")

    # Track room members
    if room_id not in room_members:
        room_members[room_id] = {}
    room_members[room_id][user_id] = sid

    # Get user info
    from app.repositories.user import User

    user = await User.get(user_id)
    if user:
        # Notify room members
        await sio.emit(
            "user_joined",
            {
                "user_id": user_id,
                "username": user.username,
                "avatar_url": user.avatar_url,
                "roomId": room_id,
            },
            room=room_id,
            skip_sid=sid,
        )

    await sio.emit("room_joined", {"room": room_id}, room=sid)

    # If it's a Yjs room, trigger a full state bridge
    module = data.get("module")
    if module in ["whiteboard", "collaboration", "document", "inquiry"]:
        from app.websocket.handlers.collaboration_handler import sync_yjs_state
        await sync_yjs_state(sio, sid, room_id, module)


@sio.event
async def leave_room(sid, data):
    """Leave a project room."""
    session = await sio.get_session(sid)
    user_id = session.get("user_id")
    if not user_id:
        return

    room_id = data.get("room_id") or data.get("room") or data.get("roomId")
    if not room_id:
        return

    if not (room_id.startswith("project:") or room_id.startswith("doc:") or room_id.startswith("wb:") or room_id.startswith("inquiry:")):
        room_id = f"project:{room_id}"

    await sio.leave_room(sid, room_id)

    # Remove from room members
    if room_id in room_members and user_id in room_members[room_id]:
        del room_members[room_id][user_id]
        if not room_members[room_id]:
            del room_members[room_id]
            # Unload room data
            from app.websocket.handlers.collaboration_handler import unload_resources
            await unload_resources(room_id)

    await sio.emit("room_left", {"room": room_id}, room=sid)


@sio.event
async def operation(sid, data):
    """Handle unified sync operations."""
    session = await sio.get_session(sid)
    user_id = session.get("user_id")
    if not user_id:
        return

    if _payload_size_chars(data) > MAX_OPERATION_PAYLOAD_CHARS:
        logger.warning("Operation payload too large from user %s", user_id)
        return

    room_id = data.get("room_id") or data.get("roomId")
    if not room_id:
        logger.warning("Operation from user %s has no room id: %s", user_id, data)
        return

    normalized_room_id = normalize_room_id(room_id, data.get("module"))
    if not await ensure_room_access(user_id, normalized_room_id):
        return

    data["roomId"] = normalized_room_id
    data["room_id"] = normalized_room_id

    # Dispatch to appropriate handler
    from app.websocket.operation_dispatcher import dispatch_operation
    await dispatch_operation(sio, sid, data, user_id)


@sio.on("batch-operations")
async def batch_operations(sid, data):
    """Handle batch of operations for reliable sync."""
    session = await sio.get_session(sid)
    user_id = session.get("user_id")
    if not user_id:
        return {"status": "error", "message": "Unauthorized"}

    operations = data.get("operations", [])
    if not operations:
        return {"status": "success", "count": 0}
    if not isinstance(operations, list):
        return {"status": "error", "message": "Invalid operations payload"}
    if len(operations) > MAX_BATCH_OPERATIONS:
        logger.warning("Batch operation count exceeded by user %s: %s", user_id, len(operations))
        return {
            "status": "error",
            "message": f"Too many operations in one batch; max is {MAX_BATCH_OPERATIONS}",
        }
    if _payload_size_chars(data) > MAX_BATCH_PAYLOAD_CHARS:
        logger.warning("Batch payload too large from user %s", user_id)
        return {"status": "error", "message": "Batch payload too large"}

    from app.websocket.operation_dispatcher import dispatch_operation

    success_count = 0
    denied_count = 0
    for op in operations:
        try:
            if not isinstance(op, dict):
                denied_count += 1
                continue
            if _payload_size_chars(op) > MAX_OPERATION_PAYLOAD_CHARS:
                denied_count += 1
                logger.warning("Single operation payload too large from user %s", user_id)
                continue
            room_id = op.get("room_id") or op.get("roomId")
            if not room_id:
                continue
            normalized_room_id = normalize_room_id(room_id, op.get("module"))
            if not await ensure_room_access(user_id, normalized_room_id):
                denied_count += 1
                continue
            op["roomId"] = normalized_room_id
            op["room_id"] = normalized_room_id
            await dispatch_operation(sio, sid, op, user_id)
            success_count += 1
        except Exception as e:
            print(f"Error processing operation in batch: {e}")

    # Return ACK
    return {"status": "success", "processed": success_count, "denied": denied_count}


@sio.on("ping")
async def handle_ping(sid):
    """Handle custom application-level heartbeat."""
    await sio.emit("pong", room=sid)



# Create ASGI app
socketio_app = ASGIApp(sio, socketio_path="/")
