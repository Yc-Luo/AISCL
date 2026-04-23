"""Authentication service."""

import asyncio
import hashlib
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Optional

from bson import ObjectId
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings
from app.core.db.mongodb import mongodb

# Use pbkdf2_sha256 instead of bcrypt for better compatibility with Python 3.13+
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against a hash."""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a password."""
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )
    to_encode.update({"exp": expire, "type": "access"})
    encoded_jwt = jwt.encode(
        to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM
    )
    return encoded_jwt


def create_refresh_token(data: dict) -> str:
    """Create a JWT refresh token."""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    encoded_jwt = jwt.encode(
        to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM
    )
    return encoded_jwt


def create_reset_token(email: str) -> str:
    """Create a password reset token."""
    expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode = {"sub": email, "type": "reset", "exp": expire}
    encoded_jwt = jwt.encode(
        to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM
    )
    return encoded_jwt


def verify_token(token: str, token_type: str = "access") -> Optional[dict]:
    """Verify and decode a JWT token."""
    try:
        payload = jwt.decode(
            token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
        if payload.get("type") != token_type:
            return None
        return payload
    except JWTError:
        return None


async def authenticate_user(
    email: Optional[str] = None,
    username: Optional[str] = None,
    phone: Optional[str] = None,
    password: str = "",
) -> Optional["User"]:
    """Authenticate a user by email/username/phone and password."""
    query = None
    if email:
        query = {"email": email}
    elif username:
        query = {"username": username}
    elif phone:
        query = {"phone": phone}

    if not query:
        return None

    users = mongodb.get_database()["users"]
    user_doc = await asyncio.wait_for(users.find_one(query), timeout=5)
    if not user_doc:
        return None

    password_hash = user_doc.get("password_hash", "")
    if not verify_password(password, password_hash):
        return None

    if not user_doc.get("is_active", True) or user_doc.get("is_banned", False):
        return None

    return SimpleNamespace(
        id=user_doc["_id"],
        username=user_doc.get("username"),
        email=user_doc.get("email"),
        phone=user_doc.get("phone"),
        password_hash=password_hash,
        role=user_doc.get("role"),
        avatar_url=user_doc.get("avatar_url"),
        settings=user_doc.get("settings", {}),
        is_active=user_doc.get("is_active", True),
        is_banned=user_doc.get("is_banned", False),
        class_id=user_doc.get("class_id"),
        created_at=user_doc.get("created_at"),
        updated_at=user_doc.get("updated_at"),
    )


async def save_refresh_token(user_id: str, token_hash: str) -> "RefreshToken":
    """Save a refresh token to the database."""
    refresh_tokens = mongodb.get_database()["refresh_tokens"]
    expires_at = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {
        "user_id": user_id,
        "token_hash": token_hash,
        "expires_at": expires_at,
        "is_revoked": False,
        "device_info": None,
        "created_at": datetime.utcnow(),
    }
    result = await asyncio.wait_for(refresh_tokens.insert_one(payload), timeout=2)
    return SimpleNamespace(id=result.inserted_id, **payload)


async def get_user_by_id(user_id: str) -> Optional[SimpleNamespace]:
    """Get a user by id using raw Mongo queries for auth-critical paths."""
    users = mongodb.get_database()["users"]
    try:
        object_id = ObjectId(user_id)
    except Exception:  # noqa: BLE001
        return None

    user_doc = await asyncio.wait_for(users.find_one({"_id": object_id}), timeout=5)
    if not user_doc:
        return None

    return SimpleNamespace(
        id=user_doc["_id"],
        username=user_doc.get("username"),
        email=user_doc.get("email"),
        phone=user_doc.get("phone"),
        password_hash=user_doc.get("password_hash", ""),
        role=user_doc.get("role"),
        avatar_url=user_doc.get("avatar_url"),
        settings=user_doc.get("settings", {}),
        is_active=user_doc.get("is_active", True),
        is_banned=user_doc.get("is_banned", False),
        class_id=user_doc.get("class_id"),
        created_at=user_doc.get("created_at"),
        updated_at=user_doc.get("updated_at"),
    )


async def revoke_refresh_token(token_hash: str) -> bool:
    """Revoke a refresh token."""
    from app.repositories.refresh_token import RefreshToken
    token = await RefreshToken.find_one(RefreshToken.token_hash == token_hash)
    if token:
        token.is_revoked = True
        await token.save()
        return True
    return False


def hash_token(token: str) -> str:
    """Create a deterministic hash for refresh-token lookup and revocation."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
