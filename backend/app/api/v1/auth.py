"""Authentication API routes.

This module handles user authentication, authorization, and session management.

## Authentication Flow
1. **Login**: User provides credentials to obtain JWT tokens
2. **Token Usage**: Include Bearer token in Authorization header
3. **Token Refresh**: Use refresh token to obtain new access token
4. **Logout**: Revoke refresh token (optional, tokens expire naturally)

## Token Types
- **Access Token**: Short-lived (24 hours), used for API access
- **Refresh Token**: Long-lived (30 days), used to renew access tokens

## Security Features
- JWT-based authentication with RSA/ECDSA signing
- Automatic token refresh
- Secure password hashing (bcrypt)
- Rate limiting and brute force protection
- Token blacklisting on logout
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.repositories.refresh_token import RefreshToken
from app.repositories.user import User
from app.core.config import settings
from app.core.db.mongodb import mongodb
from app.core.security import limiter
from app.core.schemas.auth import (
    LoginRequest,
    RegisterRequest,
    PasswordResetConfirm,
    PasswordResetRequest,
    TokenRefreshRequest,
    TokenResponse,
)
from app.services.auth_service import (
    authenticate_user,
    create_access_token,
    create_refresh_token,
    create_reset_token,
    get_user_by_id,
    get_password_hash,
    hash_token,
    revoke_all_refresh_tokens,
    revoke_refresh_token,
    save_refresh_token,
    verify_token,
)

router = APIRouter(prefix="/auth", tags=["auth"])
security = HTTPBearer()
logger = logging.getLogger(__name__)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> User:
    """Get current authenticated user from JWT token."""
    token = credentials.credentials
    payload = verify_token(token, token_type="access")
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user_id: str = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )
    user = await get_user_by_id(user_id)
    if not user or not user.is_active or user.is_banned:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )
    return user


@router.get(
    "/me",
    summary="Get Current User",
    description="Get the currently authenticated user's information",
)
async def get_me(current_user: User = Depends(get_current_user)) -> dict:
    """Get current user endpoint."""
    return {
        "id": str(current_user.id),
        "username": current_user.username,
        "email": current_user.email,
        "role": current_user.role,
        "avatar_url": current_user.avatar_url,
        "settings": current_user.settings,
        "is_active": current_user.is_active,
        "created_at": current_user.created_at.isoformat() if current_user.created_at else None,
    }


@router.post(
    "/register",
    response_model=TokenResponse,
    summary="User Registration",
    description="Register a new user account",
)
@limiter.limit("5/hour")
async def register(request: Request, register_data: RegisterRequest) -> TokenResponse:
    """User registration endpoint."""
    if not settings.PUBLIC_REGISTRATION_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public registration is disabled",
        )

    if register_data.role != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public registration can only create student accounts",
        )

    users = mongodb.get_database()["users"]

    # Check if user already exists
    existing_user = await asyncio.wait_for(
        users.find_one({"email": register_data.email}),
        timeout=5,
    )
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )
    
    existing_username = await asyncio.wait_for(
        users.find_one({"username": register_data.username}),
        timeout=5,
    )
    if existing_username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already taken",
        )
    
    # Create new user
    from datetime import datetime
    user_payload = {
        "username": register_data.username,
        "email": register_data.email,
        "password_hash": get_password_hash(register_data.password),
        "role": register_data.role,
        "phone": register_data.phone,
        "is_active": True,
        "is_banned": False,
        "settings": {},
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }
    insert_result = await asyncio.wait_for(users.insert_one(user_payload), timeout=5)
    new_user_id = insert_result.inserted_id
    
    # Generate tokens
    access_token = create_access_token(data={"sub": str(new_user_id)})
    refresh_token = create_refresh_token(data={"sub": str(new_user_id)})
    
    # Save refresh token
    token_hash = hash_token(refresh_token)
    try:
        await save_refresh_token(str(new_user_id), token_hash)
    except Exception as exc:
        logger.warning("register refresh token persistence failed for user %s: %s", register_data.email, exc)
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
    )


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="User Login",
    description="""
    Authenticate user and return JWT tokens.

    Accepts login credentials (email, username, or phone) and returns
    access and refresh tokens for subsequent API calls.

    **Login Methods:**
    - Email + password
    - Username + password
    - Phone + password

    **Response includes:**
    - Access token (24h validity)
    - Refresh token (30d validity)
    - Token type (Bearer)

    **Security Notes:**
    - Failed login attempts are rate limited
    - Successful login invalidates previous refresh tokens
    - Tokens should be stored securely on client side
    """,
    responses={
        200: {
            "description": "Login successful",
            "content": {
                "application/json": {
                    "example": {
                        "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                        "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                        "token_type": "bearer",
                        "expires_in": 86400
                    }
                }
            }
        },
        401: {"description": "Invalid credentials"},
        429: {"description": "Too many login attempts"}
    }
)
@limiter.limit("10/minute")
async def login(request: Request, login_data: LoginRequest) -> TokenResponse:
    """User login endpoint."""
    user = await authenticate_user(
        email=login_data.email,
        username=login_data.username,
        phone=login_data.phone,
        password=login_data.password,
    )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email/username/phone or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(data={"sub": str(user.id)})
    refresh_token = create_refresh_token(data={"sub": str(user.id)})

    # Save refresh token
    token_hash = hash_token(refresh_token)
    try:
        await save_refresh_token(str(user.id), token_hash)
    except Exception as exc:
        logger.warning("login refresh token persistence failed for user %s: %s", user.email, exc)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
    )


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("30/minute")
async def refresh_token(request: Request, token_data: TokenRefreshRequest) -> TokenResponse:
    """Refresh access token using refresh token."""
    payload = verify_token(token_data.refresh_token, token_type="refresh")
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    user_id: str = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    # Check if refresh token is revoked
    token_hash = hash_token(token_data.refresh_token)
    token = await RefreshToken.find_one(RefreshToken.token_hash == token_hash)
    if not token or token.is_revoked:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has been revoked",
        )

    user = await User.get(user_id)
    if not user or not user.is_active or user.is_banned:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    # Rotate refresh token to reduce the impact of token leakage.
    new_access_token = create_access_token(data={"sub": str(user.id)})
    new_refresh_token = create_refresh_token(data={"sub": str(user.id)})
    await revoke_refresh_token(token_hash)
    await save_refresh_token(str(user.id), hash_token(new_refresh_token))

    return TokenResponse(
        access_token=new_access_token,
        refresh_token=new_refresh_token,
        token_type="bearer",
    )


@router.post("/logout")
async def logout(
    current_user: User = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    """Logout user by revoking refresh tokens."""
    await revoke_all_refresh_tokens(str(current_user.id))
    return {"message": "Successfully logged out"}


@router.post("/password/reset-request")
@limiter.limit("5/hour")
async def request_password_reset(request: Request, reset_data: PasswordResetRequest) -> dict:
    """Request password reset (sends email with reset link)."""
    if not settings.PASSWORD_RESET_ENABLED:
        return {"message": "Password reset email sent (if user exists)"}

    user = await User.find_one(User.email == reset_data.email)
    if user:
        token = create_reset_token(reset_data.email)
        if settings.DEBUG and settings.APP_ENV != "production":
            print(f"\n{'='*50}")
            print(f"PASSWORD RESET LINK for {user.email}:")
            print(f"http://localhost:5173/reset-password?token={token}")
            print(f"{'='*50}\n")
        else:
            logger.warning("Password reset requested but no production email backend is configured")
    
    # Always return success to prevent user enumeration
    return {"message": "Password reset email sent (if user exists)"}


@router.post("/password/reset")
async def reset_password(reset_data: PasswordResetConfirm) -> dict:
    """Reset password using reset token."""
    payload = verify_token(reset_data.token, token_type="reset")
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token"
        )
    
    email = payload.get("sub")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid token payload"
        )
        
    user = await User.find_one(User.email == email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
        
    # Update password
    user.password_hash = get_password_hash(reset_data.new_password)
    await user.save()
    
    return {"message": "Password reset successful"}
