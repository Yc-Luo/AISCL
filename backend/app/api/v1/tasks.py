"""Task management API routes."""

import csv
import hashlib
import mimetypes
import uuid
from datetime import datetime
from io import StringIO
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from app.api.v1.auth import get_current_user
from app.core.config import settings
from app.core.permissions import can_edit_project_content, check_project_member_permission
from app.core.security import sanitize_filename
from app.repositories.course import Course
from app.repositories.course_task_release import CourseTaskRelease
from app.repositories.project import Project
from app.repositories.task import Task
from app.repositories.task_submission_artifact import TaskSubmissionArtifact
from app.repositories.user import User
from app.core.schemas.task import (
    TaskArtifactListResponse,
    TaskArtifactResponse,
    TaskCreateRequest,
    TaskListResponse,
    TaskOrderUpdateRequest,
    TaskReviewRequest,
    TaskResponse,
    TaskSubmitRequest,
    TaskUpdateRequest,
    TeacherSubmissionListResponse,
    TeacherSubmissionResponse,
)
from app.services.storage_service import storage_service

router = APIRouter(prefix="/tasks", tags=["tasks"])


ARTIFACT_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "application/pdf",
    "text/plain",
    "text/markdown",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/zip",
    "application/x-zip-compressed",
    "application/x-rar-compressed",
    "application/x-7z-compressed",
}


def _normalize_mime_type(mime_type: str) -> str:
    return (mime_type or "").split(";", 1)[0].strip().lower()


def _resolve_artifact_mime_type(filename: str, mime_type: Optional[str]) -> str:
    normalized = _normalize_mime_type(mime_type or "")
    if normalized:
        return normalized
    guessed, _ = mimetypes.guess_type(filename or "")
    return _normalize_mime_type(guessed or "")


def _ensure_allowed_artifact_mime(mime_type: str) -> str:
    normalized = _normalize_mime_type(mime_type)
    if normalized not in ARTIFACT_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported artifact file type",
        )
    return normalized


def _infer_artifact_type(mime_type: str, filename: str) -> str:
    normalized = _normalize_mime_type(mime_type)
    suffix = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower()
    if normalized.startswith("image/"):
        return "image"
    if normalized.startswith("video/"):
        return "video"
    if normalized in {
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    } or suffix in {"ppt", "pptx"}:
        return "slides"
    if normalized in {
        "application/pdf",
        "text/plain",
        "text/markdown",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    } or suffix in {"pdf", "txt", "md", "doc", "docx"}:
        return "document"
    if normalized in {"application/zip", "application/x-zip-compressed", "application/x-rar-compressed", "application/x-7z-compressed"}:
        return "archive"
    return "other"


async def ensure_project_access(current_user: User, project: Project) -> None:
    """Ensure current user can access a project task board."""
    if not await check_project_member_permission(current_user, project):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to access this project",
        )


async def ensure_project_edit_access(current_user: User, project: Project) -> None:
    """Ensure current user can edit project tasks."""
    if not await can_edit_project_content(current_user, project):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to edit tasks in this project",
        )


async def ensure_teacher_project_access(current_user: User, project: Project) -> None:
    """Ensure current user can review submissions for a project."""
    if current_user.role == "admin":
        return
    if current_user.role != "teacher":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher role required")
    if project.owner_id == str(current_user.id):
        return
    if project.course_id:
        course = await Course.get(project.course_id)
        if course and course.teacher_id == str(current_user.id):
            return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You don't have permission to review this project submission",
    )


def is_project_submission_leader(current_user: User, project: Project) -> bool:
    """Match the student workspace's group-leader fallback rules."""
    if current_user.role in {"teacher", "admin"}:
        return True
    current_user_id = str(current_user.id)
    explicit_owner_member = next(
        (
            member
            for member in project.members
            if member.get("role") == "owner" and member.get("user_id") != project.owner_id
        ),
        None,
    )
    fallback_student_member = next(
        (
            member
            for member in project.members
            if member.get("user_id") and member.get("user_id") != project.owner_id
        ),
        None,
    )
    return bool(
        current_user_id == project.owner_id
        or current_user_id == project.leader_id
        or current_user_id == (explicit_owner_member or {}).get("user_id")
        or (
            not project.leader_id
            and not explicit_owner_member
            and current_user_id == (fallback_student_member or {}).get("user_id")
        )
    )


def to_artifact_response(artifact: TaskSubmissionArtifact, include_download_url: bool = True) -> TaskArtifactResponse:
    """Convert submitted artifact document to API response."""
    return TaskArtifactResponse(
        id=str(artifact.id),
        task_id=artifact.task_id,
        project_id=artifact.project_id,
        course_id=artifact.course_id,
        course_task_release_id=artifact.course_task_release_id,
        filename=artifact.filename,
        file_key=artifact.file_key,
        mime_type=artifact.mime_type,
        size=artifact.size,
        artifact_type=artifact.artifact_type,
        checksum_sha256=artifact.checksum_sha256,
        uploaded_by=artifact.uploaded_by,
        uploaded_at=artifact.uploaded_at.isoformat(),
        download_url=storage_service.generate_presigned_get_url(artifact.file_key) if include_download_url else None,
    )


def calculate_lexorank(prev_order: Optional[float] = None, next_order: Optional[float] = None) -> float:
    """Calculate Lexorank order value."""
    if prev_order is None and next_order is None:
        return 32768.0  # Middle value
    if prev_order is None:
        return next_order / 2
    if next_order is None:
        return prev_order + 32768.0
    return (prev_order + next_order) / 2


def to_task_response(task: Task) -> TaskResponse:
    """Convert task document to API response."""
    return TaskResponse(
        id=str(task.id),
        project_id=task.project_id,
        title=task.title,
        column=task.column,
        priority=task.priority,
        assignees=task.assignees,
        order=task.order,
        description=task.description,
        due_date=task.due_date.isoformat() if task.due_date else None,
        source_type=task.source_type,
        course_task_release_id=task.course_task_release_id,
        submission_status=task.submission_status,
        submitted_at=task.submitted_at.isoformat() if task.submitted_at else None,
        submitted_by=task.submitted_by,
        submission_note=task.submission_note,
        artifact_document_id=task.artifact_document_id,
        artifact_snapshot_id=task.artifact_snapshot_id,
        submission_artifact_ids=getattr(task, "submission_artifact_ids", []) or [],
        review_status=task.review_status,
        review_comment=task.review_comment,
        reviewed_by=task.reviewed_by,
        reviewed_at=task.reviewed_at.isoformat() if task.reviewed_at else None,
        created_at=task.created_at.isoformat(),
        updated_at=task.updated_at.isoformat(),
    )


async def auto_submit_due_course_tasks(project_id: Optional[str] = None) -> int:
    """Mark due course-released tasks as automatically submitted.

    This is a lazy safeguard: it runs when task data is read or submitted, so
    the teaching workflow does not require a separate scheduler process.
    """
    now = datetime.utcnow()
    query = {
        "source_type": "course_task_release",
        "due_date": {"$lte": now},
        "$or": [
            {"submission_status": {"$exists": False}},
            {"submission_status": None},
        ],
    }
    if project_id:
        query["project_id"] = project_id

    due_tasks = await Task.find(query).to_list()
    for task in due_tasks:
        task.submission_status = "auto_submitted"
        task.submitted_at = task.due_date or now
        task.submitted_by = "system"
        task.submission_note = task.submission_note or "系统在截止时间到达后自动提交。"
        task.review_status = task.review_status or "pending"
        task.review_status = task.review_status or "pending"
        task.column = "done"
        task.updated_at = now
        await task.save()

        from app.services.research_event_service import research_event_service
        await research_event_service.record_batch_events(
            [
                {
                    "project_id": task.project_id,
                    "group_id": task.project_id,
                    "user_id": "system",
                    "actor_type": "system",
                    "event_domain": "shared_record",
                    "event_type": "course_task_auto_submit",
                    "event_time": now,
                    "payload": {
                        "task_id": str(task.id),
                        "course_task_release_id": task.course_task_release_id,
                        "due_at": task.due_date.isoformat() if task.due_date else None,
                    },
                }
            ],
            current_user_id=None,
        )

    return len(due_tasks)


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
    await ensure_project_access(current_user, project)
    await auto_submit_due_course_tasks(project_id)

    # Build query
    query = {"project_id": project_id}
    if column:
        query["column"] = column

    tasks = await Task.find(query).to_list()

    return TaskListResponse(
        tasks=[to_task_response(t) for t in tasks]
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
    await ensure_project_edit_access(current_user, project)

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
        description=task_data.description,
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

    return to_task_response(new_task)


@router.get("/teacher/submissions", response_model=TeacherSubmissionListResponse)
async def list_teacher_submissions(
    course_id: Optional[str] = Query(None),
    release_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: User = Depends(get_current_user),
) -> TeacherSubmissionListResponse:
    """List teacher-visible course task submissions."""
    if current_user.role not in {"teacher", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher role required")

    if current_user.role == "admin":
        courses = await Course.find_all().to_list()
    else:
        courses = await Course.find(Course.teacher_id == str(current_user.id)).to_list()
    course_by_id = {str(course.id): course for course in courses}
    allowed_course_ids = set(course_by_id)
    if course_id:
        if course_id not in allowed_course_ids and current_user.role != "admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have permission to access this course")
        allowed_course_ids = {course_id}

    project_query: dict = {}
    if allowed_course_ids:
        project_query["course_id"] = {"$in": list(allowed_course_ids)}
    elif current_user.role != "admin":
        project_query["owner_id"] = str(current_user.id)
    projects = await Project.find(project_query).to_list()
    project_by_id = {str(project.id): project for project in projects}
    if not project_by_id:
        return TeacherSubmissionListResponse(submissions=[])

    task_query: dict = {
        "project_id": {"$in": list(project_by_id)},
        "source_type": "course_task_release",
    }
    if release_id:
        task_query["course_task_release_id"] = release_id
    if status_filter and status_filter != "all":
        if status_filter == "unsubmitted":
            task_query["$or"] = [
                {"submission_status": {"$exists": False}},
                {"submission_status": None},
            ]
        else:
            task_query["submission_status"] = status_filter

    tasks = await Task.find(task_query).sort("-updated_at").to_list()
    release_ids = {task.course_task_release_id for task in tasks if task.course_task_release_id}
    releases = []
    for item_id in release_ids:
        release = await CourseTaskRelease.get(item_id)
        if release:
            releases.append(release)
    release_by_id = {str(release.id): release for release in releases}

    artifacts = await TaskSubmissionArtifact.find(
        {"task_id": {"$in": [str(task.id) for task in tasks]}}
    ).to_list() if tasks else []
    artifacts_by_task: dict[str, list[TaskSubmissionArtifact]] = {}
    for artifact in artifacts:
        artifacts_by_task.setdefault(artifact.task_id, []).append(artifact)

    submissions: list[TeacherSubmissionResponse] = []
    for task in tasks:
        project = project_by_id.get(task.project_id)
        if not project:
            continue
        course = course_by_id.get(project.course_id or "")
        release = release_by_id.get(task.course_task_release_id or "")
        task_artifacts = artifacts_by_task.get(str(task.id), [])
        submissions.append(
            TeacherSubmissionResponse(
                task=to_task_response(task),
                project_id=str(project.id),
                project_name=project.name,
                course_id=project.course_id,
                course_name=course.name if course else None,
                release_id=task.course_task_release_id,
                release_title=release.title if release else None,
                artifacts=[to_artifact_response(artifact) for artifact in task_artifacts],
                artifact_count=len(task_artifacts),
            )
        )

    return TeacherSubmissionListResponse(submissions=submissions)


@router.get("/teacher/submissions/export")
async def export_teacher_submissions(
    course_id: Optional[str] = Query(None),
    release_id: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Export teacher-visible submissions as CSV."""
    submissions = await list_teacher_submissions(
        course_id=course_id,
        release_id=release_id,
        status_filter=None,
        current_user=current_user,
    )
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "班级",
        "小组",
        "任务",
        "状态",
        "提交时间",
        "逾期截止",
        "成果文件数",
        "成果文件名",
        "评审状态",
        "评审意见",
    ])
    for row in submissions.submissions:
        task = row.task
        writer.writerow([
            row.course_name or "",
            row.project_name,
            task.title,
            task.submission_status or "unsubmitted",
            task.submitted_at or "",
            task.due_date or "",
            row.artifact_count,
            "；".join(artifact.filename for artifact in row.artifacts),
            task.review_status or "",
            task.review_comment or "",
        ])
    csv_bytes = output.getvalue().encode("utf-8-sig")
    filename = f"task-submissions-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}.csv"
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{task_id}/artifacts", response_model=TaskArtifactResponse)
async def upload_task_artifact(
    task_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
) -> TaskArtifactResponse:
    """Upload a file artifact for a teacher-released group task."""
    task = await Task.get(task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if task.source_type != "course_task_release" or not task.course_task_release_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only teacher-released tasks accept artifacts")
    if task.submission_status == "submitted" and current_user.role == "student":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Submitted tasks cannot be modified")

    project = await Project.get(task.project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    await ensure_project_edit_access(current_user, project)

    filename = sanitize_filename(file.filename or "artifact")
    mime_type = _ensure_allowed_artifact_mime(_resolve_artifact_mime_type(filename, file.content_type))
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")
    if len(file_bytes) > settings.MAX_FILE_SIZE:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Uploaded file exceeds the maximum allowed size")

    artifact_id = str(uuid.uuid4())
    file_key = f"projects/{task.project_id}/task-artifacts/{task_id}/{artifact_id}"
    await run_in_threadpool(storage_service.upload_file_bytes, file_key, file_bytes, mime_type)

    artifact = TaskSubmissionArtifact(
        task_id=task_id,
        project_id=task.project_id,
        course_id=project.course_id,
        course_task_release_id=task.course_task_release_id,
        filename=filename,
        file_key=file_key,
        mime_type=mime_type,
        size=len(file_bytes),
        artifact_type=_infer_artifact_type(mime_type, filename),
        checksum_sha256=hashlib.sha256(file_bytes).hexdigest(),
        uploaded_by=str(current_user.id),
    )
    await artifact.insert()

    artifact_ids = list(dict.fromkeys([*(getattr(task, "submission_artifact_ids", []) or []), str(artifact.id)]))
    task.submission_artifact_ids = artifact_ids
    task.updated_at = datetime.utcnow()
    await task.save()

    from app.services.activity_service import activity_service
    await activity_service.log_activity(
        project_id=task.project_id,
        user_id=str(current_user.id),
        module="task",
        action="artifact_upload",
        target_id=str(task.id),
        metadata={"artifact_id": str(artifact.id), "filename": filename, "artifact_type": artifact.artifact_type},
    )

    from app.services.research_event_service import research_event_service
    await research_event_service.record_batch_events(
        [
            {
                "project_id": task.project_id,
                "group_id": task.project_id,
                "user_id": str(current_user.id),
                "actor_type": "student" if current_user.role == "student" else current_user.role,
                "event_domain": "shared_record",
                "event_type": "course_task_artifact_upload",
                "event_time": artifact.uploaded_at,
                "payload": {
                    "task_id": task_id,
                    "artifact_id": str(artifact.id),
                    "artifact_type": artifact.artifact_type,
                    "mime_type": artifact.mime_type,
                    "size": artifact.size,
                },
            }
        ],
        current_user_id=str(current_user.id),
    )

    return to_artifact_response(artifact)


@router.get("/{task_id}/artifacts", response_model=TaskArtifactListResponse)
async def list_task_artifacts(
    task_id: str,
    current_user: User = Depends(get_current_user),
) -> TaskArtifactListResponse:
    """List submitted artifacts for a task."""
    task = await Task.get(task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    project = await Project.get(task.project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if current_user.role in {"teacher", "admin"}:
        await ensure_teacher_project_access(current_user, project)
    else:
        await ensure_project_access(current_user, project)

    artifacts = await TaskSubmissionArtifact.find(TaskSubmissionArtifact.task_id == task_id).sort("-uploaded_at").to_list()
    return TaskArtifactListResponse(artifacts=[to_artifact_response(artifact) for artifact in artifacts])


@router.delete("/{task_id}/artifacts/{artifact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task_artifact(
    task_id: str,
    artifact_id: str,
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete a submitted artifact before final submission."""
    task = await Task.get(task_id)
    artifact = await TaskSubmissionArtifact.get(artifact_id)
    if not task or not artifact or artifact.task_id != task_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")
    if task.submission_status == "submitted" and current_user.role == "student":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Submitted artifacts cannot be deleted")
    project = await Project.get(task.project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if current_user.role in {"teacher", "admin"}:
        await ensure_teacher_project_access(current_user, project)
    elif artifact.uploaded_by != str(current_user.id) and not is_project_submission_leader(current_user, project):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only uploader or group leader can delete this artifact")

    storage_service.delete_file(artifact.file_key)
    await artifact.delete()
    task.submission_artifact_ids = [item for item in (getattr(task, "submission_artifact_ids", []) or []) if item != artifact_id]
    task.updated_at = datetime.utcnow()
    await task.save()

    from app.services.research_event_service import research_event_service
    await research_event_service.record_batch_events(
        [
            {
                "project_id": task.project_id,
                "group_id": task.project_id,
                "user_id": str(current_user.id),
                "actor_type": current_user.role,
                "event_domain": "shared_record",
                "event_type": "course_task_artifact_delete",
                "event_time": task.updated_at,
                "payload": {"task_id": task_id, "artifact_id": artifact_id},
            }
        ],
        current_user_id=str(current_user.id),
    )


@router.get("/artifacts/{artifact_id}/download")
async def download_task_artifact(
    artifact_id: str,
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Download an artifact through the backend to avoid object-storage CORS issues."""
    artifact = await TaskSubmissionArtifact.get(artifact_id)
    if not artifact:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")
    project = await Project.get(artifact.project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if current_user.role in {"teacher", "admin"}:
        await ensure_teacher_project_access(current_user, project)
    else:
        await ensure_project_access(current_user, project)
    data = await run_in_threadpool(storage_service.get_file_bytes, artifact.file_key)
    safe_filename = artifact.filename.replace('"', "")
    return StreamingResponse(
        iter([data]),
        media_type=artifact.mime_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'},
    )


@router.post("/{task_id}/review", response_model=TaskResponse)
async def review_task_submission(
    task_id: str,
    review_data: TaskReviewRequest,
    current_user: User = Depends(get_current_user),
) -> TaskResponse:
    """Record teacher review for a submitted group task."""
    task = await Task.get(task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    project = await Project.get(task.project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    await ensure_teacher_project_access(current_user, project)

    task.review_status = review_data.review_status
    task.review_comment = review_data.review_comment
    task.reviewed_by = str(current_user.id)
    task.reviewed_at = datetime.utcnow()
    task.updated_at = task.reviewed_at
    await task.save()
    from app.services.research_event_service import research_event_service
    await research_event_service.record_batch_events(
        [
            {
                "project_id": task.project_id,
                "group_id": task.project_id,
                "user_id": str(current_user.id),
                "actor_type": "teacher" if current_user.role == "teacher" else current_user.role,
                "event_domain": "shared_record",
                "event_type": "teacher_submission_feedback_send",
                "event_time": task.reviewed_at,
                "payload": {
                    "task_id": task_id,
                    "review_status": task.review_status,
                    "comment_length": len(task.review_comment or ""),
                },
            }
        ],
        current_user_id=str(current_user.id),
    )
    return to_task_response(task)


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
    await ensure_project_edit_access(current_user, project)

    from datetime import datetime

    if task_data.title:
        task.title = task_data.title
    if task_data.priority:
        task.priority = task_data.priority
    if task_data.assignees is not None:
        task.assignees = task_data.assignees
    if task_data.description is not None:
        task.description = task_data.description
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

    return to_task_response(task)


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
    project = await Project.get(task.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    await ensure_project_edit_access(current_user, project)

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

    return to_task_response(task)


@router.post("/{task_id}/submit", response_model=TaskResponse)
async def submit_course_task(
    task_id: str,
    submit_data: TaskSubmitRequest,
    current_user: User = Depends(get_current_user),
) -> TaskResponse:
    """Submit a teacher-released group task."""
    await auto_submit_due_course_tasks()

    task = await Task.get(task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found",
        )
    if task.source_type != "course_task_release" or not task.course_task_release_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only teacher-released course tasks can be submitted",
        )

    project = await Project.get(task.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    await ensure_project_edit_access(current_user, project)
    if not is_project_submission_leader(current_user, project):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="当前仅组长可以提交小组任务",
        )

    now = datetime.utcnow()
    release = await CourseTaskRelease.get(task.course_task_release_id)
    allow_late_submission = release.allow_late_submission if release else True
    is_overdue = bool(task.due_date and now > task.due_date)

    if is_overdue and not allow_late_submission and task.submission_status == "auto_submitted":
        return to_task_response(task)
    if is_overdue and not allow_late_submission:
        task.submission_status = "auto_submitted"
        task.submitted_at = task.due_date or now
        task.submitted_by = "system"
        task.submission_note = task.submission_note or "系统在截止时间到达后自动提交。"
    else:
        if submit_data.artifact_ids:
            for artifact_id in set(submit_data.artifact_ids):
                artifact = await TaskSubmissionArtifact.get(artifact_id)
                if not artifact or artifact.task_id != task_id or artifact.project_id != task.project_id:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Some artifact files do not belong to this task",
                    )
            if len(set(submit_data.artifact_ids)) > 20:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="A submission can include at most 20 artifact files",
                )
        task.submission_status = "late_submitted" if is_overdue else "submitted"
        task.submitted_at = now
        task.submitted_by = str(current_user.id)
        task.submission_note = submit_data.note
        task.artifact_document_id = submit_data.artifact_document_id
        task.artifact_snapshot_id = submit_data.artifact_snapshot_id
        task.submission_artifact_ids = list(
            dict.fromkeys([*(getattr(task, "submission_artifact_ids", []) or []), *submit_data.artifact_ids])
        )
        task.review_status = task.review_status or "pending"

    task.column = "done"
    task.updated_at = now
    await task.save()

    from app.services.activity_service import activity_service
    await activity_service.log_activity(
        project_id=task.project_id,
        user_id=str(current_user.id),
        module="task",
        action="submit",
        target_id=str(task.id),
        metadata={
            "course_task_release_id": task.course_task_release_id,
            "submission_status": task.submission_status,
        },
    )

    from app.services.research_event_service import research_event_service
    await research_event_service.record_batch_events(
        [
            {
                "project_id": task.project_id,
                "group_id": task.project_id,
                "user_id": str(current_user.id),
                "actor_type": "student",
                "event_domain": "shared_record",
                "event_type": "course_task_submit",
                "event_time": now,
                "payload": {
                    "task_id": str(task.id),
                    "course_task_release_id": task.course_task_release_id,
                    "submission_status": task.submission_status,
                    "due_at": task.due_date.isoformat() if task.due_date else None,
                    "artifact_document_id": task.artifact_document_id,
                    "artifact_snapshot_id": task.artifact_snapshot_id,
                    "artifact_count": len(getattr(task, "submission_artifact_ids", []) or []),
                    "note_length": len(task.submission_note or ""),
                },
            }
        ],
        current_user_id=str(current_user.id),
    )

    return to_task_response(task)


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
    project = await Project.get(task.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    await ensure_project_edit_access(current_user, project)

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

    return to_task_response(task)


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
    project = await Project.get(task.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    await ensure_project_edit_access(current_user, project)

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
