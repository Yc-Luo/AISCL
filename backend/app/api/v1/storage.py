"""Storage API routes for file uploads."""

import hashlib
import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException, Query, status, BackgroundTasks
from fastapi.responses import RedirectResponse, StreamingResponse
from fastapi.concurrency import run_in_threadpool

from app.api.v1.auth import get_current_user
from app.core.config import settings
from app.core.permissions import can_edit_project_content, check_project_member_permission
from app.core.security import sanitize_filename
from app.repositories.course import Course
from app.repositories.project import Project
from app.repositories.resource import Resource
from app.repositories.user import User
from app.services.storage_service import storage_service
from app.services.rag_service import rag_service
from app.services.vector_store_service import vector_store_service
from app.services.text_extraction_service import text_extraction_service

router = APIRouter(prefix="/storage", tags=["storage"])

ALLOWED_UPLOAD_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

INLINE_IMAGE_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
}


def _normalize_mime_type(mime_type: str) -> str:
    """Normalize client-provided MIME values before validation."""
    return (mime_type or "").split(";", 1)[0].strip().lower()


def _ensure_allowed_upload_mime(mime_type: str) -> str:
    """Reject executable or browser-renderable active content uploads."""
    normalized = _normalize_mime_type(mime_type)
    if normalized not in ALLOWED_UPLOAD_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file type",
        )
    return normalized


def _ensure_project_file_key(project_id: str, file_key: str) -> None:
    """Ensure a resource record can only bind files under its own project prefix."""
    expected_prefix = f"projects/{project_id}/files/"
    if not file_key.startswith(expected_prefix):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file key for this project",
        )


def _ensure_course_file_key(course_id: str, file_key: str) -> None:
    """Ensure a resource record can only bind files under its own course prefix."""
    expected_prefix = f"courses/{course_id}/files/"
    if not file_key.startswith(expected_prefix):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file key for this course",
        )


def _has_expected_inline_image_signature(mime_type: str, prefix: bytes) -> bool:
    """Validate image previews by magic bytes, not by client-provided MIME only."""
    if mime_type == "image/png":
        return prefix.startswith(b"\x89PNG\r\n\x1a\n")
    if mime_type in {"image/jpeg", "image/jpg"}:
        return prefix.startswith(b"\xff\xd8\xff")
    if mime_type == "image/gif":
        return prefix.startswith((b"GIF87a", b"GIF89a"))
    if mime_type == "image/webp":
        return prefix.startswith(b"RIFF") and prefix[8:12] == b"WEBP"
    return False


async def ensure_project_access(current_user: User, project: Project, detail: str) -> None:
    """Ensure current user can access project-scoped storage."""
    if not await check_project_member_permission(current_user, project):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
        )


async def ensure_course_access(current_user: User, course: Course, detail: str) -> None:
    """Ensure current user can view course-scoped resources."""
    if current_user.role == "admin":
        return
    if current_user.role == "teacher" and course.teacher_id == str(current_user.id):
        return
    if str(current_user.id) in course.students:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


async def ensure_course_manage_access(current_user: User, course: Course, detail: str) -> None:
    """Ensure current user can manage course-scoped resources."""
    if current_user.role == "admin":
        return
    if current_user.role == "teacher" and course.teacher_id == str(current_user.id):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


@router.post("/presigned-url")
async def generate_presigned_url(
    filename: str = Query(...),
    file_type: str = Query(...),
    size: int = Query(..., ge=1, le=settings.MAX_FILE_SIZE),
    project_id: Optional[str] = Query(None),
    course_id: Optional[str] = Query(None),
    md5: Optional[str] = None,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Generate presigned URL for file upload."""
    _ensure_allowed_upload_mime(file_type)

    if bool(project_id) == bool(course_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Exactly one of project_id or course_id is required",
        )

    if course_id:
        course = await Course.get(course_id)
        if not course:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Course not found",
            )
        await ensure_course_manage_access(
            current_user,
            course,
            "You don't have permission to upload files to this course",
        )
        file_id = str(uuid.uuid4())
        file_key = f"courses/{course_id}/files/{file_id}"
    else:
        # Check project access
        project = await Project.get(project_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found",
            )

        await ensure_project_access(
            current_user,
            project,
            "You don't have permission to upload files to this project",
        )
        file_id = str(uuid.uuid4())
        file_key = f"projects/{project_id}/files/{file_id}"

    # Check storage quota
    # TODO: Calculate current project/course storage usage

    # Generate presigned URL
    upload_url = storage_service.generate_presigned_put_url(
        file_key, expires_in=300
    )

    return {
        "upload_url": upload_url,
        "file_key": file_key,
        "expires_in": 300,
    }


class CreateResourceRequest(BaseModel):
    file_key: str
    filename: str
    size: int
    project_id: Optional[str] = None
    course_id: Optional[str] = None
    scope: str = Field(default="project", pattern="^(project|course)$")
    mime_type: str
    source_type: str = Field(
        default="library",
        pattern="^(library|document_embed|chat_attachment|inquiry_material)$",
    )


@router.post("/resources")
async def create_resource(
    resource_data: CreateResourceRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Create resource record after file upload."""
    normalized_mime_type = _ensure_allowed_upload_mime(resource_data.mime_type)

    if resource_data.scope == "course":
        if not resource_data.course_id or resource_data.project_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Course-scoped resources require course_id only",
            )
        course = await Course.get(resource_data.course_id)
        if not course:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Course not found",
            )
        await ensure_course_manage_access(
            current_user,
            course,
            "You don't have permission to create resources in this course",
        )
        _ensure_course_file_key(resource_data.course_id, resource_data.file_key)
    else:
        if not resource_data.project_id or resource_data.course_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Project-scoped resources require project_id only",
            )
        # Check project access
        project = await Project.get(resource_data.project_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found",
            )
        await ensure_project_access(
            current_user,
            project,
            "You don't have permission to create resources in this project",
        )
        _ensure_project_file_key(resource_data.project_id, resource_data.file_key)

    actual_size = await run_in_threadpool(storage_service.get_file_size, resource_data.file_key)
    if actual_size is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file not found in object storage",
        )
    if actual_size != resource_data.size:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file size does not match the resource metadata",
        )

    if normalized_mime_type in INLINE_IMAGE_MIME_TYPES:
        prefix = await run_in_threadpool(storage_service.get_file_prefix, resource_data.file_key, 16)
        if not _has_expected_inline_image_signature(normalized_mime_type, prefix):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Image file signature does not match the declared MIME type",
            )

    # Generate download URL
    download_url = storage_service.generate_presigned_get_url(resource_data.file_key)

    # Create resource record
    resource = Resource(
        project_id=resource_data.project_id,
        course_id=resource_data.course_id,
        scope=resource_data.scope,
        filename=resource_data.filename,
        file_key=resource_data.file_key,
        url=download_url,
        size=resource_data.size,
        mime_type=normalized_mime_type,
        source_type=resource_data.source_type,
        uploaded_by=str(current_user.id),
    )
    await resource.insert()

    # Trigger RAG vectorization in background
    # Note: Real implementation needs to download file from S3, extract text (via PDFMiner/OCR), 
    # and then call rag_service.
    # We define a helper task here.
    async def process_resource_task(resource_id: str, file_key: str):
        """Extract lightweight resource text and index it for semantic retrieval."""
        try:
            file_bytes = await run_in_threadpool(storage_service.get_file_bytes, file_key)
            text_content = ""
            if text_extraction_service.can_extract(normalized_mime_type, resource_data.filename):
                text_content = text_extraction_service.extract_text(
                    file_bytes,
                    normalized_mime_type,
                    resource_data.filename,
                )
            if not text_content:
                text_content = (
                    f"资源文件：{resource_data.filename}\n"
                    f"类型：{normalized_mime_type}\n"
                    "该文件暂未抽取正文，可作为资源库引用来源。"
                )
            await rag_service.process_resource(resource_id, text_content)
        except Exception as exc:
            print(f"Resource RAG indexing skipped: {exc}")

    if resource.source_type == "library":
        background_tasks.add_task(process_resource_task, str(resource.id), resource.file_key)

    if resource_data.project_id:
        # Log project-scoped activity
        from app.services.activity_service import activity_service
        await activity_service.log_activity(
            project_id=resource_data.project_id,
            user_id=str(current_user.id),
            module="resources",
            action="upload",
            target_id=str(resource.id),
            metadata={"filename": resource_data.filename}
        )


    return {
        "id": str(resource.id),
        "filename": resource.filename,
        "url": resource.url,
        "size": resource.size,
        "mime_type": resource.mime_type,
        "project_id": resource.project_id,
        "course_id": resource.course_id,
        "scope": resource.scope,
        "source_type": resource.source_type,
        "uploaded_by": resource.uploaded_by,
        "uploaded_at": resource.uploaded_at.isoformat(),
    }


@router.get("/resources/{project_id}")
async def list_resources(
    project_id: str,
    source_type: str = Query("library", pattern="^(library|document_embed|chat_attachment|inquiry_material|all)$"),
    include_course_resources: bool = Query(False),
    current_user: User = Depends(get_current_user),
) -> dict:
    """List project resources."""
    # Check project access
    project = await Project.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    await ensure_project_access(
        current_user,
        project,
        "You don't have permission to access this project",
    )

    # Get project resources
    if source_type == "all":
        resources = await Resource.find(
            {
                "project_id": project_id,
                "$or": [
                    {"scope": "project"},
                    {"scope": {"$exists": False}},
                    {"scope": None},
                ],
            }
        ).to_list()
    elif source_type == "library":
        resources = await Resource.find(
            {
                "project_id": project_id,
                "$and": [
                    {
                        "$or": [
                            {"scope": "project"},
                            {"scope": {"$exists": False}},
                            {"scope": None},
                        ],
                    },
                    {
                        "$or": [
                            {"source_type": "library"},
                            {"source_type": {"$exists": False}},
                            {"source_type": None},
                        ],
                    },
                ],
            }
        ).to_list()
    else:
        resources = await Resource.find(
            Resource.project_id == project_id,
            Resource.scope == "project",
            Resource.source_type == source_type,
        ).to_list()

    if include_course_resources and project.course_id and source_type in {"library", "all"}:
        course_resources = await Resource.find(
            Resource.course_id == project.course_id,
            Resource.scope == "course",
            Resource.source_type == "library",
        ).to_list()
        resources.extend(course_resources)

    # Generate fresh presigned URLs
    resource_list = []
    for resource in resources:
        download_url = storage_service.generate_presigned_get_url(
            resource.file_key
        )
        resource_list.append(
            {
                "id": str(resource.id),
                "filename": resource.filename,
                "url": download_url,
                "size": resource.size,
                "mime_type": resource.mime_type,
                "project_id": resource.project_id,
                "course_id": resource.course_id,
                "scope": resource.scope,
                "source_type": resource.source_type,
                "uploaded_by": resource.uploaded_by,
                "uploaded_at": resource.uploaded_at.isoformat(),
            }
        )

    return {"resources": resource_list}


@router.get("/course-resources/{course_id}")
async def list_course_resources(
    course_id: str,
    current_user: User = Depends(get_current_user),
) -> dict:
    """List teacher-provided course resources."""
    course = await Course.get(course_id)
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found",
        )
    await ensure_course_access(
        current_user,
        course,
        "You don't have permission to access this course",
    )

    resources = await Resource.find(
        Resource.course_id == course_id,
        Resource.scope == "course",
        Resource.source_type == "library",
    ).to_list()

    resource_list = []
    for resource in resources:
        resource_list.append(
            {
                "id": str(resource.id),
                "filename": resource.filename,
                "url": storage_service.generate_presigned_get_url(resource.file_key),
                "size": resource.size,
                "mime_type": resource.mime_type,
                "project_id": resource.project_id,
                "course_id": resource.course_id,
                "scope": resource.scope,
                "source_type": resource.source_type,
                "uploaded_by": resource.uploaded_by,
                "uploaded_at": resource.uploaded_at.isoformat(),
            }
        )

    return {"resources": resource_list}


@router.delete("/resources/{resource_id}")
async def delete_resource(
    resource_id: str,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Delete a resource."""
    resource = await Resource.get(resource_id)
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found",
        )

    is_uploader = resource.uploaded_by == str(current_user.id)

    if resource.scope == "course":
        if not resource.course_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Course not found",
            )
        course = await Course.get(resource.course_id)
        if not course:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Course not found",
            )
        if not is_uploader:
            await ensure_course_manage_access(
                current_user,
                course,
                "You don't have permission to delete this course resource",
            )
    else:
        # Check permission (Editor/Owner only)
        project = await Project.get(resource.project_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Project not found",
            )

        if not (is_uploader or await can_edit_project_content(current_user, project)):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to delete this resource",
            )

    # Capture info for logging before deletion
    filename = resource.filename
    resource_id_str = str(resource.id)
    project_id = resource.project_id
    file_key = resource.file_key

    # Delete from storage first
    try:
        storage_service.delete_file(file_key)
    except Exception as e:
        print(f"Warning: Failed to delete file from storage: {e}")

    # Delete from database
    await resource.delete()

    index_project_id = None
    if resource.scope == "course" and resource.course_id:
        index_project_id = rag_service.course_resource_namespace(resource.course_id)
    elif resource.project_id:
        index_project_id = resource.project_id
    if index_project_id:
        await vector_store_service.delete_source_points(
            project_id=index_project_id,
            source_type="resource",
            source_id=resource_id_str,
        )

    # Log activity using captured data
    if project_id:
        try:
            from app.services.activity_service import activity_service
            await activity_service.log_activity(
                project_id=project_id,
                user_id=str(current_user.id),
                module="resources",
                action="delete",
                target_id=resource_id_str,
                metadata={"filename": filename}
            )
        except Exception as e:
            print(f"Warning: Failed to log activity for deletion: {e}")

    return {"message": "Resource deleted successfully"}


async def _ensure_resource_download_access(current_user: User, resource: Resource) -> None:
    """Ensure current user can download a resource."""
    if resource.scope == "course":
        if not resource.course_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
        course = await Course.get(resource.course_id)
        if not course:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
        await ensure_course_access(
            current_user,
            course,
            "You don't have permission to download this course resource",
        )
        return

    project = await Project.get(resource.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )
    await ensure_project_access(
        current_user,
        project,
        "You don't have permission to download this resource",
    )


@router.get("/resources/{resource_id}/view")
async def view_resource(
    resource_id: str
):
    """View image resources by proxying from storage.

    This endpoint remains unauthenticated because editor image tags cannot attach
    Bearer headers. To avoid exposing arbitrary active content, only validated
    image resources are served here. Other resources must use the authenticated
    download endpoint.
    """
    resource = await Resource.get(resource_id)
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found",
        )

    normalized_mime_type = _normalize_mime_type(resource.mime_type)
    if normalized_mime_type not in INLINE_IMAGE_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only image previews are available through this endpoint",
        )

    try:
        prefix = await run_in_threadpool(storage_service.get_file_prefix, resource.file_key, 16)
        if not _has_expected_inline_image_signature(normalized_mime_type, prefix):
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Stored file does not match an allowed image signature",
            )

        # Get object stream from storage
        response = storage_service.client.get_object(
            settings.MINIO_BUCKET_NAME,
            resource.file_key
        )
        
        # Generator to yield chunks and ensure closing
        def iter_file():
            try:
                yield from response.stream(32 * 1024)
            finally:
                response.close()
                response.release_conn()

        return StreamingResponse(
            iter_file(),
            media_type=normalized_mime_type,
            headers={
                "Content-Disposition": f'inline; filename="{sanitize_filename(resource.filename)}"',
                "Cache-Control": "private, max-age=300",
                "X-Content-Type-Options": "nosniff",
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error proxying resource: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to stream resource",
        )


@router.get("/resources/{resource_id}/download")
async def download_resource(
    resource_id: str,
    current_user: User = Depends(get_current_user),
):
    """Download resource."""
    resource = await Resource.get(resource_id)
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found",
        )
    await _ensure_resource_download_access(current_user, resource)
    
    # Generate fresh presigned URL
    download_url = storage_service.generate_presigned_get_url(resource.file_key)
    
    return RedirectResponse(url=download_url)
