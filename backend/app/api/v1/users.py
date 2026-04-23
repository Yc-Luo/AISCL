"""User management API routes."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.v1.auth import get_current_user
from app.repositories.user import User
from app.core.schemas.user import UserCreateRequest, UserResponse, UserUpdateRequest, UserListResponse
from app.services.auth_service import get_password_hash

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=UserListResponse)
async def list_users(
    role: Optional[str] = None,
    class_id: Optional[str] = None,
    search: Optional[str] = None,
    current_user: User = Depends(get_current_user),
) -> UserListResponse:
    """List and filter users (Admin/Teacher only)."""
    if current_user.role not in ["admin", "teacher"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admin and teacher can list users",
        )

    query = {}
    if role:
        query["role"] = role
    if class_id:
        query["class_id"] = class_id
    if search:
        query["$or"] = [
            {"username": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
        ]

    users_data = await User.find(query).to_list()
    users_response = [
        UserResponse(
            id=str(user.id),
            username=user.username,
            email=user.email,
            phone=user.phone,
            avatar_url=user.avatar_url,
            role=user.role,
            settings=user.settings,
            class_id=user.class_id,
            is_active=user.is_active,
            created_at=user.created_at,
        )
        for user in users_data
    ]
    return UserListResponse(users=users_response)


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    """Get current user information."""
    return UserResponse(
        id=str(current_user.id),
        username=current_user.username,
        email=current_user.email,
        phone=current_user.phone,
        avatar_url=current_user.avatar_url,
        role=current_user.role,
        settings=current_user.settings,
        class_id=current_user.class_id,
        is_active=current_user.is_active,
        created_at=current_user.created_at,
    )


@router.put("/me", response_model=UserResponse)
async def update_current_user(
    user_data: UserUpdateRequest,
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    """Update current user information."""
    if user_data.username:
        current_user.username = user_data.username
    if user_data.avatar_url is not None:
        current_user.avatar_url = user_data.avatar_url
    if user_data.settings:
        current_user.settings.update(user_data.settings)

    await current_user.save()

    return UserResponse(
        id=str(current_user.id),
        username=current_user.username,
        email=current_user.email,
        phone=current_user.phone,
        avatar_url=current_user.avatar_url,
        role=current_user.role,
        settings=current_user.settings,
        class_id=current_user.class_id,
        is_active=current_user.is_active,
        created_at=current_user.created_at,
    )


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: str,
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    """Get user information by ID."""
    user = await User.get(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Students can only see their own info, or info of members in the same projects
    if current_user.role == "student" and str(current_user.id) != user_id:
        # Check if they share any project
        from app.repositories.project import Project
        shared_project = await Project.find_one({
            "$and": [
                {"$or": [{"owner_id": str(current_user.id)}, {"members.user_id": str(current_user.id)}]},
                {"$or": [{"owner_id": user_id}, {"members.user_id": user_id}]}
            ]
        })
        if not shared_project:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to view this user",
            )

    return UserResponse(
        id=str(user.id),
        username=user.username,
        email=user.email,
        phone=user.phone,
        avatar_url=user.avatar_url,
        role=user.role,
        settings=user.settings,
        class_id=user.class_id,
        is_active=user.is_active,
        created_at=user.created_at,
    )


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    user_data: UserCreateRequest,
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    """Create a new user (Admin/Teacher only)."""
    if current_user.role not in ["admin", "teacher"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admin and teacher can create users",
        )

    # Check if user already exists
    conditions = [
        User.email == user_data.email,
        User.username == user_data.username,
    ]
    if user_data.phone:
        conditions.append(User.phone == user_data.phone)

    from beanie.operators import Or

    existing_user = await User.find_one(Or(*conditions))
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User with this email, username, or phone already exists",
        )

    # Create new user
    new_user = User(
        username=user_data.username,
        email=user_data.email,
        phone=user_data.phone,
        password_hash=get_password_hash(user_data.password),
        role=user_data.role,
        class_id=user_data.class_id,
    )
    await new_user.insert()

    return UserResponse(
        id=str(new_user.id),
        username=new_user.username,
        email=new_user.email,
        phone=new_user.phone,
        avatar_url=new_user.avatar_url,
        role=new_user.role,
        settings=new_user.settings,
        class_id=new_user.class_id,
        is_active=new_user.is_active,
        created_at=new_user.created_at,
    )

