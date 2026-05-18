"""Admin APIs for assigning research configuration permissions to teachers."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.api.v1.auth import get_current_user
from app.repositories.system_config import SystemConfig
from app.repositories.user import User
from app.services.config_permission_service import config_permission_service
from app.services.research_config_service import research_config_service

router = APIRouter(prefix="/admin/config-permissions", tags=["admin-config-permissions"])


class TeacherPermissionUpdateRequest(BaseModel):
    """Request body for teacher permission updates."""

    teacher_tags: Optional[List[str]] = None
    config_permissions: Optional[Dict[str, List[str]]] = None


class BatchTeacherPermissionUpdateRequest(BaseModel):
    """Batch permission update request."""

    teacher_ids: List[str] = Field(..., min_length=1)
    teacher_tags: Optional[List[str]] = None
    config_permissions: Optional[Dict[str, List[str]]] = None
    replace_tags: bool = False


async def _require_admin(current_user: User) -> None:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")


def _normalize_tags(tags: Optional[List[str]]) -> List[str]:
    if not tags:
        return []
    normalized: List[str] = []
    for tag in tags:
        next_tag = str(tag).strip()
        if next_tag and next_tag not in normalized:
            normalized.append(next_tag)
    return normalized


def _normalize_permissions(value: Optional[Dict[str, List[str]]]) -> Optional[Dict[str, List[str]]]:
    if value is None:
        return None
    allowed_keys = {"allowed_template_ids", "allowed_rule_profile_ids", "allowed_model_ids"}
    normalized: Dict[str, List[str]] = {}
    for key in allowed_keys:
        if key not in value:
            continue
        source = value.get(key) or []
        normalized[key] = []
        for item in source:
            next_item = str(item).strip()
            if next_item and next_item not in normalized[key]:
                normalized[key].append(next_item)
    return normalized


def _teacher_payload(user: User) -> Dict[str, Any]:
    return {
        "id": str(user.id),
        "username": user.username or user.email,
        "email": user.email,
        "role": user.role,
        "teacher_tags": list(user.teacher_tags or []),
        "config_permissions": user.config_permissions,
        "is_active": user.is_active,
        "is_banned": user.is_banned,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
    }


async def _load_json_config(key: str, fallback: Any) -> Any:
    config = await SystemConfig.find_one(SystemConfig.key == key)
    if not config or not config.value:
        return fallback
    try:
        return json.loads(config.value)
    except json.JSONDecodeError:
        return fallback


async def _rule_profile_options() -> List[Dict[str, Any]]:
    profiles = await _load_json_config("research_rule_profiles", [])
    options: List[Dict[str, Any]] = []
    seen: set[str] = set()
    if isinstance(profiles, list):
        for profile in profiles:
            if not isinstance(profile, dict):
                continue
            profile_id = str(profile.get("id") or "").strip()
            if not profile_id or profile_id in seen:
                continue
            options.append(
                {
                    "id": profile_id,
                    "label": profile.get("label") or profile_id,
                    "delivery_mode": profile.get("deliveryMode"),
                    "summary": profile.get("summary"),
                }
            )
            seen.add(profile_id)
    for profile_id, label in {
        "research-default": "研究默认规则集",
        "research-default+group-chat-live": "研究默认规则集 + 群聊短提示",
    }.items():
        if profile_id not in seen:
            options.append({"id": profile_id, "label": label})
    return options


@router.get("/teachers")
async def list_teacher_permissions(
    search: Optional[str] = None,
    tag: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """List teachers and their assigned research configuration permissions."""
    await _require_admin(current_user)

    query: Dict[str, Any] = {"role": "teacher"}
    if search:
        query["$or"] = [
            {"username": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
        ]
    if tag:
        query["teacher_tags"] = tag

    teachers = await User.find(query).skip((page - 1) * limit).limit(limit).sort("username").to_list()
    total = await User.find(query).count()
    return {"items": [_teacher_payload(teacher) for teacher in teachers], "total": total}


@router.get("/teachers/{teacher_id}")
async def get_teacher_permissions(
    teacher_id: str,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Get one teacher's permission details."""
    await _require_admin(current_user)
    teacher = await User.get(teacher_id)
    if not teacher or teacher.role != "teacher":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found")
    return _teacher_payload(teacher)


@router.put("/teachers/{teacher_id}")
async def update_teacher_permissions(
    teacher_id: str,
    data: TeacherPermissionUpdateRequest,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Update one teacher's tags and permissions."""
    await _require_admin(current_user)
    teacher = await User.get(teacher_id)
    if not teacher or teacher.role != "teacher":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found")

    if data.teacher_tags is not None:
        teacher.teacher_tags = _normalize_tags(data.teacher_tags)
    if "config_permissions" in data.model_fields_set:
        teacher.config_permissions = _normalize_permissions(data.config_permissions)
    teacher.updated_at = datetime.utcnow()
    await teacher.save()
    return _teacher_payload(teacher)


@router.put("/teachers/batch")
async def batch_update_teacher_permissions(
    data: BatchTeacherPermissionUpdateRequest,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Apply one permission set to multiple teachers."""
    await _require_admin(current_user)

    updated = 0
    normalized_tags = _normalize_tags(data.teacher_tags)
    normalized_permissions = _normalize_permissions(data.config_permissions)
    for teacher_id in data.teacher_ids:
        teacher = await User.get(teacher_id)
        if not teacher or teacher.role != "teacher":
            continue
        if data.teacher_tags is not None:
            if data.replace_tags:
                teacher.teacher_tags = normalized_tags
            else:
                teacher.teacher_tags = _normalize_tags([*(teacher.teacher_tags or []), *normalized_tags])
        if "config_permissions" in data.model_fields_set:
            teacher.config_permissions = normalized_permissions
        teacher.updated_at = datetime.utcnow()
        await teacher.save()
        updated += 1

    return {"updated": updated}


@router.get("/available-options")
async def get_available_permission_options(
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return assignable templates, rule profiles, models, and teacher tags."""
    await _require_admin(current_user)

    teachers = await User.find(User.role == "teacher").to_list()
    tags = sorted({tag for teacher in teachers for tag in (teacher.teacher_tags or []) if tag})
    return {
        "templates": await research_config_service.list_available_template_options(),
        "rule_profiles": await _rule_profile_options(),
        "models": await config_permission_service.get_model_options(),
        "teacher_tags": tags,
    }
