import logging
from typing import Dict, Optional, Any

from socketio import AsyncServer, ASGIApp
from socketio.exceptions import ConnectionRefusedError

from app.core.config import settings
from app.services.auth_service import verify_token
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

# Store user connections: {user_id: [sid1, sid2, ...]}
user_connections: Dict[str, list] = {}
# Store room members: {room_id: {user_id: sid}}
room_members: Dict[str, Dict[str, str]] = {}


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

    # Format room ID: project:{project_id}, doc:{id}, wb:{id}, inquiry:{id}
    if not (room_id.startswith("project:") or room_id.startswith("doc:") or room_id.startswith("wb:") or room_id.startswith("inquiry:")):
        if module == "inquiry":
            room_id = f"inquiry:{room_id}"
        elif module == "document":
            room_id = f"doc:{room_id}"
        else:
            room_id = f"project:{room_id}"

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

    from app.websocket.operation_dispatcher import dispatch_operation

    success_count = 0
    for op in operations:
        try:
            await dispatch_operation(sio, sid, op, user_id)
            success_count += 1
        except Exception as e:
            print(f"Error processing operation in batch: {e}")

    # Return ACK
    return {"status": "success", "processed": success_count}


@sio.on("ping")
async def handle_ping(sid):
    """Handle custom application-level heartbeat."""
    await sio.emit("pong", room=sid)



# Create ASGI app
socketio_app = ASGIApp(sio, socketio_path="/")
