"""Storage API routes for file uploads."""

import hashlib
import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from fastapi import APIRouter, Depends, HTTPException, Query, status, BackgroundTasks
from fastapi.responses import RedirectResponse, StreamingResponse
from fastapi.concurrency import run_in_threadpool

from app.api.v1.auth import get_current_user
from app.core.config import settings
from app.core.permissions import can_edit_project_content, check_project_member_permission
from app.repositories.project import Project
from app.repositories.resource import Resource
from app.repositories.user import User
from app.services.storage_service import storage_service
from app.services.rag_service import rag_service
from app.services.text_extraction_service import text_extraction_service

router = APIRouter(prefix="/storage", tags=["storage"])


async def ensure_project_access(current_user: User, project: Project, detail: str) -> None:
    """Ensure current user can access project-scoped storage."""
    if not await check_project_member_permission(current_user, project):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
        )


@router.post("/presigned-url")
async def generate_presigned_url(
    filename: str = Query(...),
    file_type: str = Query(...),
    size: int = Query(..., ge=1, le=settings.MAX_FILE_SIZE),
    project_id: str = Query(...),
    md5: Optional[str] = None,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Generate presigned URL for file upload."""
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

    # Check storage quota
    # TODO: Calculate current project storage usage
    # For now, we'll skip this check

    # Generate file key
    file_id = str(uuid.uuid4())
    file_key = f"projects/{project_id}/files/{file_id}"

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
    project_id: str
    mime_type: str


@router.post("/resources")
async def create_resource(
    resource_data: CreateResourceRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Create resource record after file upload."""
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

    # Generate download URL
    download_url = storage_service.generate_presigned_get_url(resource_data.file_key)

    # Create resource record
    resource = Resource(
        project_id=resource_data.project_id,
        filename=resource_data.filename,
        file_key=resource_data.file_key,
        url=download_url,
        size=resource_data.size,
        mime_type=resource_data.mime_type,
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
            if text_extraction_service.can_extract(resource_data.mime_type, resource_data.filename):
                text_content = text_extraction_service.extract_text(
                    file_bytes,
                    resource_data.mime_type,
                    resource_data.filename,
                )
            if not text_content:
                text_content = (
                    f"资源文件：{resource_data.filename}\n"
                    f"类型：{resource_data.mime_type}\n"
                    "该文件暂未抽取正文，可作为资源库引用来源。"
                )
            await rag_service.process_resource(resource_id, text_content)
        except Exception as exc:
            print(f"Resource RAG indexing skipped: {exc}")

    background_tasks.add_task(process_resource_task, str(resource.id), resource.file_key)

    # Log activity
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
        "uploaded_by": resource.uploaded_by,
        "uploaded_at": resource.uploaded_at.isoformat(),
    }


@router.get("/resources/{project_id}")
async def list_resources(
    project_id: str,
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

    # Get resources
    resources = await Resource.find(Resource.project_id == project_id).to_list()

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

    # Check permission (Editor/Owner only)
    project = await Project.get(resource.project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    is_uploader = resource.uploaded_by == str(current_user.id)

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

    # Log activity using captured data
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


@router.get("/resources/{resource_id}/view")
async def view_resource(
    resource_id: str
):
    """View resource by proxying from storage."""
    resource = await Resource.get(resource_id)
    if not resource:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource not found",
        )

    try:
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
            media_type=resource.mime_type
        )
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
    
    # Generate fresh presigned URL
    download_url = storage_service.generate_presigned_get_url(resource.file_key)
    
    return RedirectResponse(url=download_url)
