import logging
from app.websocket.handlers.collaboration_handler import handle_collaboration_op
from app.websocket.handlers.chat_handler import handle_chat_op

logger = logging.getLogger(__name__)

async def dispatch_operation(sio, sid, data, user_id):
    """
    Dispatch operation to specific handler based on module.
    """
    module = data.get("module")
    room_id = data.get("roomId") or data.get("room_id")
    
    logger.info(f"Dispatching {data.get('type')} op from {user_id} in {room_id} (module: {module})")
    
    if module in ["whiteboard", "collaboration", "document", "inquiry"]:
        await handle_collaboration_op(sio, sid, data, user_id, module=module)
    elif module == "chat":
        await handle_chat_op(sio, sid, data, user_id)
    else:
        logger.warning(f"Unknown module operation: {module} from user {user_id}")
