"""Admin API routes for system management."""

import json
from datetime import datetime, timedelta
from time import perf_counter
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.v1.auth import get_current_user
from app.repositories.system_config import SystemConfig
from app.repositories.system_log import SystemLog
from app.repositories.user import User
from app.core.schemas.admin import (
    SystemConfigResponse,
    SystemConfigUpdateRequest,
    SystemLogListResponse,
    SystemLogResponse,
    UserBanRequest,
    UserResponse,
    UserListResponse,
    UserCreateRequest,
    UserUpdateRequest,
    SystemStatsResponse,
    BroadcastRequest,
    ActivityLogResponse,
    ActivityLogListResponse,
)
from app.repositories.course import Course
from app.repositories.project import Project
from app.repositories.resource import Resource
from app.repositories.activity_log import ActivityLog
from app.services.auth_service import get_password_hash
from app.core.llm_config import get_llm
from app.services.embedding_service import embedding_service

router = APIRouter(prefix="/admin", tags=["admin"])

MASKED_SECRET_VALUE = "********"
SECRET_CONFIG_KEYS = {
    "llm_key",
    "embedding_key",
}


async def _require_admin(current_user: User) -> None:
    """Guard endpoints that must only be available to system administrators."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin only",
        )


def _safe_config_summary(configs: Dict[str, Optional[str]], prefix: str) -> Dict[str, Any]:
    """Return non-secret config fields for test responses."""
    return {
        "provider": configs.get(f"{prefix}_provider"),
        "base_url": configs.get(f"{prefix}_base_url"),
        "model": configs.get(f"{prefix}_model"),
        "has_key": bool(configs.get(f"{prefix}_key")),
    }


def _is_secret_config_key(key: str) -> bool:
    """Return whether a system config key contains sensitive material."""
    lowered = key.lower()
    return (
        key in SECRET_CONFIG_KEYS
        or lowered.endswith("_secret")
        or lowered.endswith("_password")
        or lowered.endswith("_token")
    )


def _mask_custom_model_keys(value: str) -> str:
    """Mask API keys inside user-defined model JSON."""
    try:
        models = json.loads(value)
    except Exception:  # noqa: BLE001
        return value
    if not isinstance(models, list):
        return value
    masked = []
    for item in models:
        if isinstance(item, dict):
            next_item = dict(item)
            if next_item.get("key"):
                next_item["key"] = MASKED_SECRET_VALUE
            masked.append(next_item)
        else:
            masked.append(item)
    return json.dumps(masked, ensure_ascii=False)


def _mask_config_value(key: str, value: str) -> str:
    """Mask secret values before returning configs to the frontend."""
    if key == "user_custom_models":
        return _mask_custom_model_keys(value)
    if _is_secret_config_key(key) and value:
        return MASKED_SECRET_VALUE
    return value


def _merge_custom_model_secret_keys(next_value: str, current_value: Optional[str]) -> str:
    """Preserve existing custom model keys when the frontend submits masked values."""
    if not current_value:
        return next_value
    try:
        next_models = json.loads(next_value)
        current_models = json.loads(current_value)
    except Exception:  # noqa: BLE001
        return next_value
    if not isinstance(next_models, list) or not isinstance(current_models, list):
        return next_value

    current_by_id = {
        item.get("id"): item
        for item in current_models
        if isinstance(item, dict) and item.get("id")
    }
    merged = []
    for item in next_models:
        if not isinstance(item, dict):
            merged.append(item)
            continue
        next_item = dict(item)
        if next_item.get("key") == MASKED_SECRET_VALUE:
            current_item = current_by_id.get(next_item.get("id"))
            if current_item and current_item.get("key"):
                next_item["key"] = current_item["key"]
        merged.append(next_item)
    return json.dumps(merged, ensure_ascii=False)


async def _get_config_map(keys: List[str]) -> Dict[str, Optional[str]]:
    """Read selected system config values."""
    result: Dict[str, Optional[str]] = {}
    for key in keys:
        config = await SystemConfig.find_one(SystemConfig.key == key)
        value = config.value if config else None
        result[key] = value.strip() if isinstance(value, str) else value
    return result


@router.get("/system-configs", response_model=List[SystemConfigResponse])
async def get_system_configs(
    current_user: User = Depends(get_current_user),
) -> List[SystemConfigResponse]:
    """Get all system configurations (Admin only)."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admin can view system configurations",
        )

    configs = await SystemConfig.find().to_list()

    return [
        SystemConfigResponse(
            key=c.key,
            value=_mask_config_value(c.key, c.value),
            description=c.description,
            updated_by=c.updated_by,
            updated_at=c.updated_at,
        )
        for c in configs
    ]


@router.put("/system-configs/{key}", response_model=SystemConfigResponse)
async def update_system_config(
    key: str,
    config_data: SystemConfigUpdateRequest,
    current_user: User = Depends(get_current_user),
) -> SystemConfigResponse:
    """Update system configuration (Admin only)."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admin can update system configurations",
        )

    next_value = config_data.value

    # Get or create config
    config = await SystemConfig.find_one(SystemConfig.key == key)
    if config and _is_secret_config_key(key) and next_value == MASKED_SECRET_VALUE:
        next_value = config.value
    if config and key == "user_custom_models":
        next_value = _merge_custom_model_secret_keys(next_value, config.value)

    if not config:
        config = SystemConfig(
            key=key,
            value=next_value,
            description=config_data.description,
            updated_by=str(current_user.id),
        )
        await config.insert()
    else:
        config.value = next_value
        if config_data.description is not None:
            config.description = config_data.description
        config.updated_by = str(current_user.id)
        config.updated_at = datetime.utcnow()
        await config.save()

    return SystemConfigResponse(
        key=config.key,
        value=_mask_config_value(config.key, config.value),
        description=config.description,
        updated_by=config.updated_by,
        updated_at=config.updated_at,
    )


@router.post("/system-configs/test-llm")
async def test_llm_config(
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Test the currently active dialogue LLM configuration without exposing secrets."""
    await _require_admin(current_user)

    configs = await _get_config_map(["llm_provider", "llm_base_url", "llm_model", "llm_key"])
    started_at = perf_counter()

    try:
        llm = await get_llm(temperature=0)
        response = await llm.ainvoke("请只回复：AISCL_OK")
        elapsed_ms = round((perf_counter() - started_at) * 1000)
        content = response.content if hasattr(response, "content") else str(response)

        return {
            "success": True,
            "service": "llm",
            "latency_ms": elapsed_ms,
            "response_preview": content[:120],
            "config": _safe_config_summary(configs, "llm"),
        }
    except Exception as exc:
        elapsed_ms = round((perf_counter() - started_at) * 1000)
        return {
            "success": False,
            "service": "llm",
            "latency_ms": elapsed_ms,
            "error": str(exc),
            "config": _safe_config_summary(configs, "llm"),
        }


@router.post("/system-configs/test-embedding")
async def test_embedding_config(
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Test the currently active embedding configuration without exposing secrets."""
    await _require_admin(current_user)

    configs = await _get_config_map(
        [
            "embedding_provider",
            "embedding_base_url",
            "embedding_model",
            "embedding_key",
            "embedding_dimensions",
        ]
    )
    started_at = perf_counter()

    try:
        vector = await embedding_service.embed_text(
            "AISCL embedding connectivity test",
            purpose="query",
        )
        elapsed_ms = round((perf_counter() - started_at) * 1000)
        if not vector:
            return {
                "success": False,
                "service": "embedding",
                "latency_ms": elapsed_ms,
                "error": "未返回向量。请检查 RAG_VECTOR_ENABLED、API Key、Base URL、模型 ID 和向量维度配置。",
                "config": {
                    **_safe_config_summary(configs, "embedding"),
                    "configured_dimensions": configs.get("embedding_dimensions"),
                },
            }

        return {
            "success": True,
            "service": "embedding",
            "latency_ms": elapsed_ms,
            "vector_dimensions": len(vector),
            "config": {
                **_safe_config_summary(configs, "embedding"),
                "configured_dimensions": configs.get("embedding_dimensions"),
            },
        }
    except Exception as exc:
        elapsed_ms = round((perf_counter() - started_at) * 1000)
        return {
            "success": False,
            "service": "embedding",
            "latency_ms": elapsed_ms,
            "error": str(exc),
            "config": {
                **_safe_config_summary(configs, "embedding"),
                "configured_dimensions": configs.get("embedding_dimensions"),
            },
        }


@router.get("/system-logs", response_model=SystemLogListResponse)
async def get_system_logs(
    log_type: Optional[str] = Query(None, pattern="^(performance|operation|error|security)$"),
    level: Optional[str] = Query(None, pattern="^(info|warning|error|critical)$"),
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    current_user: User = Depends(get_current_user),
) -> SystemLogListResponse:
    """Get system logs (Admin only)."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admin can view system logs",
        )

    # Build query
    query = {}
    if log_type:
        query["log_type"] = log_type
    if level:
        query["level"] = level
    if start_date:
        query["timestamp"] = {"$gte": start_date}
    if end_date:
        if "timestamp" in query:
            query["timestamp"]["$lte"] = end_date
        else:
            query["timestamp"] = {"$lte": end_date}

    # Get logs
    logs = (
        await SystemLog.find(query)
        .skip(skip)
        .limit(limit)
        .sort("-timestamp")
        .to_list()
    )
    total = await SystemLog.find(query).count()

    return SystemLogListResponse(
        logs=[
            SystemLogResponse(
                id=str(log.id),
                log_type=log.log_type,
                level=log.level,
                module=log.module,
                message=log.message,
                details=log.details,
                user_id=log.user_id,
                ip_address=log.ip_address,
                timestamp=log.timestamp,
            )
            for log in logs
        ],
        total=total,
    )


@router.get("/users", response_model=UserListResponse)
async def list_users(
    role: Optional[str] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    current_user: User = Depends(get_current_user),
) -> UserListResponse:
    """List all users (Admin only)."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    
    query = {}
    if role:
        query["role"] = role
    if search:
        query["$or"] = [
            {"username": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
        ]
    
    users = await User.find(query).skip((page - 1) * limit).limit(limit).to_list()
    total = await User.find(query).count()
    
    # Enrich with course name if student
    items = []
    for u in users:
        course_name = None
        if u.role == "student" and u.class_id:
            course = await Course.get(u.class_id)
            if course:
                course_name = course.name
        
        items.append(UserResponse(
            id=str(u.id),
            username=u.username or u.email.split('@')[0],
            email=u.email,
            role=u.role,
            class_id=u.class_id,
            course_name=course_name,
            is_active=u.is_active,
            is_banned=u.is_banned,
            created_at=u.created_at,
            last_active=u.updated_at  # Using updated_at as last_active fallback
        ))
    
    return UserListResponse(items=items, total=total)


@router.post("/users", response_model=UserResponse)
async def create_user(
    user_data: UserCreateRequest,
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    """Create a new user (Admin only)."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    
    if await User.find_one(User.email == user_data.email):
        raise HTTPException(status_code=400, detail="Email already registered")
    
    new_user = User(
        username=user_data.username,
        email=user_data.email,
        password_hash=get_password_hash(user_data.password),
        role=user_data.role,
        class_id=user_data.class_id,
    )
    await new_user.insert()
    
    return UserResponse(
        id=str(new_user.id),
        username=new_user.username,
        email=new_user.email,
        role=new_user.role,
        class_id=new_user.class_id,
        is_active=new_user.is_active,
        is_banned=new_user.is_banned,
        created_at=new_user.created_at
    )


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    user_data: UserUpdateRequest,
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    """Update a user (Admin only)."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    
    user = await User.get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user_data.email is not None and user_data.email != user.email:
        existing_user = await User.find_one(User.email == user_data.email)
        if existing_user:
            raise HTTPException(status_code=400, detail="Email already registered")
    
    # Update fields
    if user_data.username is not None:
        user.username = user_data.username
    if user_data.email is not None:
        user.email = user_data.email
    if user_data.role is not None:
        user.role = user_data.role
    if user_data.class_id is not None:
        user.class_id = user_data.class_id
    if user_data.is_active is not None:
        user.is_active = user_data.is_active
    if user_data.is_banned is not None:
        user.is_banned = user_data.is_banned
    
    await user.save()
    
    return UserResponse(
        id=str(user.id),
        username=user.username,
        email=user.email,
        role=user.role,
        class_id=user.class_id,
        is_active=user.is_active,
        is_banned=user.is_banned,
        created_at=user.created_at
    )


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete a user (Admin only)."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    
    user = await User.get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    await user.delete()


@router.get("/stats", response_model=SystemStatsResponse)
async def get_system_stats(
    current_user: User = Depends(get_current_user),
) -> SystemStatsResponse:
    """Get system stats (Admin only)."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    
    total_users = await User.count()
    active_users = await User.find({"is_active": True, "is_banned": False}).count()
    active_projects = await Project.find(Project.is_archived == False).count()
    resources = await Resource.find_all().to_list()
    storage_used = sum(resource.size for resource in resources)
    active_ratio = active_users / total_users if total_users else 0
    
    return SystemStatsResponse(
        total_users=total_users,
        active_projects=active_projects,
        system_load=round(active_ratio, 4),
        storage_used=storage_used,
    )


@router.post("/broadcast", status_code=204)
async def broadcast_notification(
    data: BroadcastRequest,
    current_user: User = Depends(get_current_user),
) -> None:
    """Broadcast notification to all users (Admin only)."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    
    # Actually saving this to global notification system would be better
    from app.repositories.system_log import SystemLog
    log = SystemLog(
        log_type="operation",
        level="info",
        module="admin",
        message=f"Broadcast: {data.title}",
        details={"body": data.body},
        user_id=str(current_user.id)
    )
    await log.insert()


@router.post("/users/{user_id}/ban", status_code=status.HTTP_204_NO_CONTENT)
async def ban_user(
    user_id: str,
    ban_data: UserBanRequest,
    current_user: User = Depends(get_current_user),
) -> None:
    """Ban a user (Admin only)."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admin can ban users",
        )

    user = await User.get(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    user.is_banned = True
    if ban_data.duration_days:
        # Store ban expiration (would need a ban_expires_at field)
        # For now, just set is_banned
        pass
    await user.save()

    # Log the action
    from app.repositories.system_log import SystemLog

    log = SystemLog(
        log_type="operation",
        level="info",
        module="admin",
        message=f"User {user_id} banned by {current_user.id}",
        details={"reason": ban_data.reason, "duration_days": ban_data.duration_days},
        user_id=str(current_user.id),
    )
    await log.insert()


@router.post("/users/{user_id}/unban", status_code=status.HTTP_204_NO_CONTENT)
async def unban_user(
    user_id: str,
    current_user: User = Depends(get_current_user),
) -> None:
    """Unban a user (Admin only)."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admin can unban users",
        )

    user = await User.get(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    user.is_banned = False
    await user.save()

    # Log the action
    from app.repositories.system_log import SystemLog

    log = SystemLog(
        log_type="operation",
        level="info",
        module="admin",
        message=f"User {user_id} unbanned by {current_user.id}",
        user_id=str(current_user.id),
    )
    await log.insert()

@router.get("/behavior-logs", response_model=ActivityLogListResponse)
async def get_behavior_logs(
    user_id: Optional[str] = None,
    project_id: Optional[str] = None,
    module: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
    current_user: User = Depends(get_current_user),
) -> ActivityLogListResponse:
    """Get learning behavior logs (Admin only)."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admin can view behavior logs",
        )

    # Build query
    query = {}
    if user_id:
        query["user_id"] = user_id
    if project_id:
        query["project_id"] = project_id
    if module:
        query["module"] = module
    if start_date:
        query["timestamp"] = {"$gte": start_date}
    if end_date:
        if "timestamp" in query:
            query["timestamp"]["$lte"] = end_date
        else:
            query["timestamp"] = {"$lte": end_date}

    # Get logs
    logs = (
        await ActivityLog.find(query)
        .skip(skip)
        .limit(limit)
        .sort("-timestamp")
        .to_list()
    )
    total = await ActivityLog.find(query).count()

    # Enrich with usernames
    user_ids = list(set(log.user_id for log in logs))
    users = await User.find({"_id": {"$in": [str(uid) for uid in user_ids]}}).to_list()
    user_map = {str(u.id): u.username or u.email.split('@')[0] for u in users}

    return ActivityLogListResponse(
        logs=[
            ActivityLogResponse(
                id=str(log.id),
                project_id=log.project_id,
                user_id=log.user_id,
                username=user_map.get(log.user_id, "Unknown"),
                module=log.module,
                action=log.action,
                target_id=log.target_id,
                duration=log.duration,
                metadata=log.metadata,
                timestamp=log.timestamp,
            )
            for log in logs
        ],
        total=total,
    )


@router.get("/behavior-logs/export")
async def export_behavior_logs(
    user_id: Optional[str] = None,
    project_id: Optional[str] = None,
    module: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    format: str = Query("csv", pattern="^(csv|json)$"),
    current_user: User = Depends(get_current_user),
):
    """Export learning behavior logs as CSV or JSON (Admin only)."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admin can export behavior logs",
        )

    # Build query
    query = {}
    if user_id:
        query["user_id"] = user_id
    if project_id:
        query["project_id"] = project_id
    if module:
        query["module"] = module
    if start_date:
        query["timestamp"] = {"$gte": start_date}
    if end_date:
        if "timestamp" in query:
            query["timestamp"]["$lte"] = end_date
        else:
            query["timestamp"] = {"$lte": end_date}

    # Get logs (up to 10000 for export)
    logs = (
        await ActivityLog.find(query)
        .sort("-timestamp")
        .limit(10000)
        .to_list()
    )

    if format == "json":
        return logs

    # CSV Export
    import io
    import csv
    from fastapi.responses import StreamingResponse

    # Fetch users for mapping
    user_ids = list(set(log.user_id for log in logs))
    users = await User.find({"_id": {"$in": [str(uid) for uid in user_ids]}}).to_list()
    user_map = {str(u.id): u.username or u.email.split('@')[0] for u in users}

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Timestamp", "User", "Project ID", "Module", "Action", "Target ID", "Duration (s)", "Metadata"])

    for log in logs:
        writer.writerow([
            str(log.id),
            log.timestamp.isoformat(),
            user_map.get(log.user_id, log.user_id),
            log.project_id,
            log.module,
            log.action,
            log.target_id or "",
            log.duration,
            str(log.metadata) if log.metadata else ""
        ])

    output.seek(0)
    filename = f"behavior_logs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
