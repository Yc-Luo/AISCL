"""On-demand resource preview conversion."""

from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.security import sanitize_filename
from app.repositories.resource import Resource
from app.services.storage_service import storage_service


logger = logging.getLogger(__name__)


class PreviewConversionUnavailable(RuntimeError):
    """Raised when the server cannot convert a resource for preview."""


class ResourcePreviewService:
    """Convert Office documents to PDF previews and cache them in object storage."""

    OFFICE_MIME_TYPES = {
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }
    OFFICE_EXTENSIONS = {".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"}

    def can_convert_to_pdf(self, resource: Resource) -> bool:
        mime_type = (resource.mime_type or "").split(";", 1)[0].strip().lower()
        suffix = Path(resource.filename or "").suffix.lower()
        return mime_type in self.OFFICE_MIME_TYPES or suffix in self.OFFICE_EXTENSIONS

    def preview_pdf_key(self, resource: Resource) -> str:
        parent = resource.file_key.rsplit("/", 1)[0]
        return f"{parent}/previews/{resource.id}.pdf"

    def get_or_create_pdf_preview_key(self, resource: Resource) -> str:
        if not self.can_convert_to_pdf(resource):
            raise PreviewConversionUnavailable("This file type cannot be converted to PDF preview")

        preview_key = self.preview_pdf_key(resource)
        if storage_service.get_file_size(preview_key) is not None:
            return preview_key

        soffice = shutil.which("soffice") or shutil.which("libreoffice")
        if not soffice:
            raise PreviewConversionUnavailable("LibreOffice is not installed on the backend server")

        with tempfile.TemporaryDirectory(prefix="aiscl-preview-") as temp_dir:
            temp_path = Path(temp_dir)
            safe_name = sanitize_filename(resource.filename or "resource")
            input_path = temp_path / safe_name
            profile_path = temp_path / "lo-profile"
            output_dir = temp_path / "out"
            output_dir.mkdir(parents=True, exist_ok=True)
            profile_path.mkdir(parents=True, exist_ok=True)

            with input_path.open("wb") as writer:
                storage_service.write_file_to(resource.file_key, writer)

            command = [
                soffice,
                "--headless",
                "--nologo",
                "--nofirststartwizard",
                "--norestore",
                f"-env:UserInstallation=file://{profile_path}",
                "--convert-to",
                "pdf",
                "--outdir",
                str(output_dir),
                str(input_path),
            ]
            try:
                result = subprocess.run(
                    command,
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=90,
                )
            except subprocess.TimeoutExpired as exc:
                raise PreviewConversionUnavailable("Office preview conversion timed out") from exc

            if result.returncode != 0:
                logger.warning(
                    "Office preview conversion failed for %s: %s %s",
                    resource.id,
                    result.stdout,
                    result.stderr,
                )
                raise PreviewConversionUnavailable("Office preview conversion failed")

            candidates = sorted(output_dir.glob("*.pdf"))
            if not candidates:
                raise PreviewConversionUnavailable("Office preview conversion produced no PDF")

            pdf_path = candidates[0]
            with pdf_path.open("rb") as reader:
                storage_service.upload_file_object(
                    preview_key,
                    reader,
                    pdf_path.stat().st_size,
                    "application/pdf",
                )

        return preview_key


resource_preview_service = ResourcePreviewService()
