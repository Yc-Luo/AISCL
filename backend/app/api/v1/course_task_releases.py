"""Course-level group task release API routes."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.v1.auth import get_current_user
from app.repositories.course import Course
from app.repositories.course_task_release import CourseTaskRelease
from app.repositories.document import Document
from app.repositories.project import Project
from app.repositories.task import Task
from app.repositories.user import User
from app.core.schemas.course_task_release import (
    CourseTaskReleaseCreateRequest,
    CourseTaskReleaseListResponse,
    CourseTaskReleaseResponse,
)

router = APIRouter(prefix="/course-task-releases", tags=["course-task-releases"])


def _ensure_course_manage_access(current_user: User, course: Course) -> None:
    if current_user.role != "admin" and course.teacher_id != str(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the course teacher can manage task releases",
        )


def _compose_task_description(release_data: CourseTaskReleaseCreateRequest) -> str:
    sections = [
        ("任务背景", release_data.task_background),
        ("核心问题", release_data.core_question),
        ("协作要求", release_data.collaboration_requirements),
        ("提交成果", release_data.deliverable_requirements),
        ("评价要点", release_data.evaluation_points),
    ]
    return "\n\n".join(
        f"{title}\n{content.strip()}"
        for title, content in sections
        if content and content.strip()
    )


def _compose_document_content(
    release_data: CourseTaskReleaseCreateRequest,
    *,
    published_at: datetime,
) -> str:
    """Build student-facing task brief content for the shared document."""
    lines = [
        f"任务标题\n{release_data.title.strip()}",
        f"发布时间\n{published_at.strftime('%Y-%m-%d %H:%M')}",
        f"截止时间\n{release_data.due_at.strftime('%Y-%m-%d %H:%M') if release_data.due_at else '未设置'}",
        f"逾期处理\n{'允许截止后继续提交或完善' if release_data.allow_late_submission else '截止后不再开放提交或完善'}",
    ]
    section_map = [
        ("一、任务背景", release_data.task_background),
        ("二、核心问题", release_data.core_question),
        ("三、协作要求", release_data.collaboration_requirements),
        ("四、提交成果", release_data.deliverable_requirements),
        ("五、评价要点", release_data.evaluation_points),
    ]
    lines.extend(
        f"{title}\n{content.strip()}"
        for title, content in section_map
        if content and content.strip()
    )
    return "\n\n".join(lines)


def _to_response(
    release: CourseTaskRelease,
    *,
    course_name: Optional[str] = None,
    submission_stats: Optional[dict] = None,
) -> CourseTaskReleaseResponse:
    stats = submission_stats or {}
    return CourseTaskReleaseResponse(
        id=str(release.id),
        course_id=release.course_id,
        course_name=course_name,
        teacher_id=release.teacher_id,
        title=release.title,
        task_background=release.task_background,
        core_question=release.core_question,
        collaboration_requirements=release.collaboration_requirements,
        deliverable_requirements=release.deliverable_requirements,
        evaluation_points=release.evaluation_points,
        due_at=release.due_at.isoformat() if release.due_at else None,
        allow_late_submission=release.allow_late_submission,
        status=release.status,
        target_project_ids=release.target_project_ids,
        target_project_count=len(release.target_project_ids),
        synced_task_ids=release.synced_task_ids,
        synced_task_count=len(release.synced_task_ids),
        synced_document_ids=release.synced_document_ids,
        synced_document_count=len(release.synced_document_ids),
        submitted_count=stats.get("submitted_count", 0),
        manual_submitted_count=stats.get("manual_submitted_count", 0),
        late_submitted_count=stats.get("late_submitted_count", 0),
        auto_submitted_count=stats.get("auto_submitted_count", 0),
        created_by=release.created_by,
        created_at=release.created_at.isoformat(),
        updated_at=release.updated_at.isoformat(),
        published_at=release.published_at.isoformat(),
        closed_at=release.closed_at.isoformat() if release.closed_at else None,
    )


async def _get_release_submission_stats(release_id: str) -> dict:
    tasks = await Task.find({"course_task_release_id": release_id}).to_list()
    manual_submitted_count = sum(1 for task in tasks if task.submission_status == "submitted")
    late_submitted_count = sum(1 for task in tasks if task.submission_status == "late_submitted")
    auto_submitted_count = sum(1 for task in tasks if task.submission_status == "auto_submitted")
    return {
        "submitted_count": manual_submitted_count + late_submitted_count + auto_submitted_count,
        "manual_submitted_count": manual_submitted_count,
        "late_submitted_count": late_submitted_count,
        "auto_submitted_count": auto_submitted_count,
    }


async def _auto_submit_due_release_tasks(release_ids: list[str]) -> None:
    if not release_ids:
        return
    now = datetime.utcnow()
    due_tasks = await Task.find(
        {
            "course_task_release_id": {"$in": release_ids},
            "source_type": "course_task_release",
            "due_date": {"$lte": now},
            "$or": [
                {"submission_status": {"$exists": False}},
                {"submission_status": None},
            ],
        }
    ).to_list()
    for task in due_tasks:
        task.submission_status = "auto_submitted"
        task.submitted_at = task.due_date or now
        task.submitted_by = "system"
        task.submission_note = task.submission_note or "系统在截止时间到达后自动提交。"
        task.column = "done"
        task.updated_at = now
        await task.save()


@router.get("/courses/{course_id}", response_model=CourseTaskReleaseListResponse)
async def list_course_task_releases(
    course_id: str,
    current_user: User = Depends(get_current_user),
) -> CourseTaskReleaseListResponse:
    """List teacher-published group tasks for a course."""
    course = await Course.get(course_id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )
    _ensure_course_manage_access(current_user, course)

    releases = (
        await CourseTaskRelease.find(CourseTaskRelease.course_id == course_id)
        .sort("-created_at")
        .to_list()
    )
    await _auto_submit_due_release_tasks([str(release.id) for release in releases])

    responses = []
    for release in releases:
        responses.append(
            _to_response(
                release,
                course_name=course.name,
                submission_stats=await _get_release_submission_stats(str(release.id)),
            )
        )

    return CourseTaskReleaseListResponse(releases=responses)


@router.post("/courses/{course_id}", response_model=CourseTaskReleaseResponse, status_code=status.HTTP_201_CREATED)
async def create_course_task_release(
    course_id: str,
    release_data: CourseTaskReleaseCreateRequest,
    current_user: User = Depends(get_current_user),
) -> CourseTaskReleaseResponse:
    """Publish one task to every active group in a course."""
    course = await Course.get(course_id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )
    _ensure_course_manage_access(current_user, course)

    projects = await Project.find(
        {
            "course_id": course_id,
            "is_archived": False,
        }
    ).to_list()
    if not projects:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The course has no active groups to receive this task",
        )
    target_project_ids = [str(project.id) for project in projects]

    now = datetime.utcnow()
    release = CourseTaskRelease(
        course_id=course_id,
        teacher_id=course.teacher_id,
        title=release_data.title.strip(),
        task_background=release_data.task_background,
        core_question=release_data.core_question,
        collaboration_requirements=release_data.collaboration_requirements,
        deliverable_requirements=release_data.deliverable_requirements,
        evaluation_points=release_data.evaluation_points,
        due_at=release_data.due_at,
        allow_late_submission=release_data.allow_late_submission,
        status="open",
        target_project_ids=target_project_ids,
        created_by=str(current_user.id),
        created_at=now,
        updated_at=now,
        published_at=now,
    )
    await release.insert()

    description = _compose_task_description(release_data)
    document_content = _compose_document_content(release_data, published_at=now)
    synced_task_ids: list[str] = []
    synced_document_ids: list[str] = []
    for project in projects:
        existing_task = await Task.find_one(
            {
                "project_id": str(project.id),
                "course_task_release_id": str(release.id),
            }
        )
        if existing_task:
            synced_task_ids.append(str(existing_task.id))
            continue

        existing_tasks = await Task.find(
            {"project_id": str(project.id), "column": "todo"}
        ).to_list()
        max_order = max([task.order for task in existing_tasks], default=0.0) if existing_tasks else 0.0
        task = Task(
            project_id=str(project.id),
            title=release.title,
            description=description or None,
            column="todo",
            priority="high" if release.due_at else "medium",
            assignees=[],
            order=max_order + 32768.0,
            due_date=release.due_at,
            source_type="course_task_release",
            course_task_release_id=str(release.id),
        )
        await task.insert()
        synced_task_ids.append(str(task.id))

        document = Document(
            project_id=str(project.id),
            title=f"任务发布：{release.title}"[:200],
            content=document_content,
            content_state=b"",
            preview_text=document_content[:200] or None,
            last_modified_by=str(current_user.id),
            source_type="course_task_release",
            course_task_release_id=str(release.id),
        )
        await document.insert()
        synced_document_ids.append(str(document.id))

        from app.services.wiki_service import wiki_service
        await wiki_service.create_item(
            {
                "project_id": str(project.id),
                "group_id": str(project.id),
                "item_type": "task_brief",
                "title": document.title,
                "content": document_content,
                "summary": document_content[:500],
                "source_type": "teacher_brief",
                "source_id": str(document.id),
                "visibility": "project",
                "confidence_level": "verified",
            },
            current_user_id=str(current_user.id),
            actor_type="teacher",
        )

        from app.services.activity_service import activity_service
        await activity_service.log_activity(
            project_id=str(project.id),
            user_id=str(current_user.id),
            module="teacher_task_release",
            action="publish",
            target_id=str(release.id),
            metadata={
                "course_id": course_id,
                "task_id": str(task.id),
                "due_at": release.due_at.isoformat() if release.due_at else None,
            },
        )

        from app.services.research_event_service import research_event_service
        await research_event_service.record_batch_events(
            [
                {
                    "project_id": str(project.id),
                    "group_id": str(project.id),
                    "user_id": str(current_user.id),
                    "actor_type": "teacher",
                    "event_domain": "shared_record",
                    "event_type": "teacher_task_release_publish",
                    "event_time": now,
                    "payload": {
                        "course_id": course_id,
                        "release_id": str(release.id),
                        "task_id": str(task.id),
                        "document_id": str(document.id),
                        "title": release.title,
                        "due_at": release.due_at.isoformat() if release.due_at else None,
                    },
                }
            ],
            current_user_id=str(current_user.id),
        )

    release.synced_task_ids = synced_task_ids
    release.synced_document_ids = synced_document_ids
    release.updated_at = datetime.utcnow()
    await release.save()
    await _auto_submit_due_release_tasks([str(release.id)])

    return _to_response(
        release,
        course_name=course.name,
        submission_stats=await _get_release_submission_stats(str(release.id)),
    )


@router.post("/{release_id}/close", response_model=CourseTaskReleaseResponse)
async def close_course_task_release(
    release_id: str,
    current_user: User = Depends(get_current_user),
) -> CourseTaskReleaseResponse:
    """Close a course task release without deleting group task records."""
    release = await CourseTaskRelease.get(release_id)
    if not release:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task release not found",
        )

    course = await Course.get(release.course_id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )
    _ensure_course_manage_access(current_user, course)

    release.status = "closed"
    release.closed_at = datetime.utcnow()
    release.updated_at = release.closed_at
    await release.save()
    await _auto_submit_due_release_tasks([str(release.id)])

    return _to_response(
        release,
        course_name=course.name,
        submission_stats=await _get_release_submission_stats(str(release.id)),
    )
