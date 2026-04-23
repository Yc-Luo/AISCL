"""Task management API routes."""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.v1.auth import get_current_user
from app.core.permissions import check_project_permission
from app.repositories.project import Project
from app.repositories.task import Task
from app.repositories.user import User
from app.core.schemas.task import (
    TaskCreateRequest,
    TaskListResponse,
    TaskOrderUpdateRequest,
    TaskResponse,
    TaskUpdateRequest,
)

router = APIRouter(prefix="/tasks", tags=["tasks"])


def calculate_lexorank(prev_order: Optional[float] = None, next_order: Optional[float] = None) -> float:
    """Calculate Lexorank order value."""
    if prev_order is None and next_order is None:
        return 32768.0  # Middle value
    if prev_order is None:
        return next_order / 2
    if next_order is None:
        return prev_order + 32768.0
    return (prev_order + next_order) / 2


@router.get("/projects/{project_id}", response_model=TaskListResponse)
async def get_tasks(
    project_id: str,
    column: Optional[str] = Query(None, pattern="^(todo|doing|done)$"),
    current_user: User = Depends(get_current_user),
) -> TaskListResponse:
    """Get project tasks."""
    # Check project access
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Build query
    query = {"project_id": project_id}
    if column:
        query["column"] = column

    tasks = await Task.find(query).to_list()

    return TaskListResponse(
        tasks=[
            TaskResponse(
                id=str(t.id),
                project_id=t.project_id,
                title=t.title,
                column=t.column,
                priority=t.priority,
                assignees=t.assignees,
                order=t.order,
                due_date=t.due_date.isoformat() if t.due_date else None,
                created_at=t.created_at.isoformat(),
                updated_at=t.updated_at.isoformat(),
            )
            for t in tasks
        ]
    )


@router.post("/projects/{project_id}", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(
    project_id: str,
    task_data: TaskCreateRequest,
    current_user: User = Depends(get_current_user),
) -> TaskResponse:
    """Create a new task."""
    # Check project access
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Calculate order (append to end of column)
    existing_tasks = await Task.find(
        {"project_id": project_id, "column": task_data.column}
    ).to_list()
    max_order = max([t.order for t in existing_tasks], default=0.0) if existing_tasks else 0.0
    new_order = max_order + 32768.0

    # Create task
    new_task = Task(
        project_id=project_id,
        title=task_data.title,
        column=task_data.column,
        priority=task_data.priority,
        assignees=task_data.assignees or [],
        order=new_order,
        due_date=task_data.due_date,
    )
    await new_task.insert()

    # Log activity
    from app.services.activity_service import activity_service
    await activity_service.log_activity(
        project_id=project_id,
        user_id=str(current_user.id),
        module="task",
        action="create",
        target_id=str(new_task.id)
    )

    return TaskResponse(
        id=str(new_task.id),
        project_id=new_task.project_id,
        title=new_task.title,
        column=new_task.column,
        priority=new_task.priority,
        assignees=new_task.assignees,
        order=new_task.order,
        due_date=new_task.due_date.isoformat() if new_task.due_date else None,
        created_at=new_task.created_at.isoformat(),
        updated_at=new_task.updated_at.isoformat(),
    )


@router.put("/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: str,
    task_data: TaskUpdateRequest,
    current_user: User = Depends(get_current_user),
) -> TaskResponse:
    """Update a task."""
    task = await Task.get(task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found",
        )

    # Check project access
    project = await Project.get(task.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    from datetime import datetime

    if task_data.title:
        task.title = task_data.title
    if task_data.priority:
        task.priority = task_data.priority
    if task_data.assignees is not None:
        task.assignees = task_data.assignees
    if task_data.due_date is not None:
        task.due_date = task_data.due_date
    task.updated_at = datetime.utcnow()

    await task.save()

    # Log activity
    from app.services.activity_service import activity_service
    await activity_service.log_activity(
        project_id=task.project_id,
        user_id=str(current_user.id),
        module="task",
        action="update",
        target_id=str(task.id)
    )

    return TaskResponse(
        id=str(task.id),
        project_id=task.project_id,
        title=task.title,
        column=task.column,
        priority=task.priority,
        assignees=task.assignees,
        order=task.order,
        due_date=task.due_date.isoformat() if task.due_date else None,
        created_at=task.created_at.isoformat(),
        updated_at=task.updated_at.isoformat(),
    )


@router.put("/{task_id}/column", response_model=TaskResponse)
async def update_task_column(
    task_id: str,
    column: str = Query(..., pattern="^(todo|doing|done)$"),
    current_user: User = Depends(get_current_user),
) -> TaskResponse:
    """Update task column (for drag-and-drop)."""
    task = await Task.get(task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found",
        )

    old_column = task.column
    task.column = column

    # Recalculate order in new column
    existing_tasks = await Task.find(
        {"project_id": task.project_id, "column": column}
    ).to_list()
    max_order = max([t.order for t in existing_tasks if str(t.id) != task_id], default=0.0) if existing_tasks else 0.0
    task.order = max_order + 32768.0

    from datetime import datetime

    task.updated_at = datetime.utcnow()
    await task.save()

    # Log activity
    from app.services.activity_service import activity_service
    await activity_service.log_activity(
        project_id=task.project_id,
        user_id=str(current_user.id),
        module="task",
        action="move",
        target_id=str(task.id),
        metadata={"from": old_column, "to": column}
    )

    return TaskResponse(
        id=str(task.id),
        project_id=task.project_id,
        title=task.title,
        column=task.column,
        priority=task.priority,
        assignees=task.assignees,
        order=task.order,
        due_date=task.due_date.isoformat() if task.due_date else None,
        created_at=task.created_at.isoformat(),
        updated_at=task.updated_at.isoformat(),
    )


@router.put("/{task_id}/order", response_model=TaskResponse)
async def update_task_order(
    task_id: str,
    order_data: TaskOrderUpdateRequest,
    current_user: User = Depends(get_current_user),
) -> TaskResponse:
    """Update task order (for drag-and-drop sorting)."""
    task = await Task.get(task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found",
        )

    # Calculate new order using Lexorank
    prev_order = order_data.prev_order
    next_order = order_data.next_order
    new_order = calculate_lexorank(prev_order, next_order)

    task.order = new_order

    from datetime import datetime

    task.updated_at = datetime.utcnow()
    await task.save()

    # Log activity
    from app.services.activity_service import activity_service
    await activity_service.log_activity(
        project_id=task.project_id,
        user_id=str(current_user.id),
        module="task",
        action="update",
        target_id=str(task.id),
        metadata={"type": "order"}
    )

    return TaskResponse(
        id=str(task.id),
        project_id=task.project_id,
        title=task.title,
        column=task.column,
        priority=task.priority,
        assignees=task.assignees,
        order=task.order,
        due_date=task.due_date.isoformat() if task.due_date else None,
        created_at=task.created_at.isoformat(),
        updated_at=task.updated_at.isoformat(),
    )


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete a task."""
    task = await Task.get(task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found",
        )

    await task.delete()

    # Log activity
    from app.services.activity_service import activity_service
    await activity_service.log_activity(
        project_id=task.project_id,
        user_id=str(current_user.id),
        module="task",
        action="delete",
        target_id=str(task.id)
    )

