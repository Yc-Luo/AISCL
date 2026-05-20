"""Document parsing service for resource RAG ingestion."""

from __future__ import annotations

import asyncio
import io
import logging
import zipfile
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

import httpx

from app.core.config import settings
from app.repositories.resource import Resource
from app.repositories.system_config import SystemConfig
from app.services.rag_service import rag_service
from app.services.storage_service import storage_service

logger = logging.getLogger(__name__)

MASKED_SECRET_VALUE = "********"
MINERU_SUPPORTED_MIME_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
    "image/bmp",
}


@dataclass
class MinerUConfig:
    """Resolved MinerU runtime configuration."""

    enabled: bool
    api_token: str
    base_url: str
    model_version: str
    enable_table: bool
    enable_formula: bool
    is_ocr: bool
    language: str
    poll_interval_seconds: int
    timeout_seconds: int


def _as_bool(value: Optional[str], default: bool) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on", "enabled"}


def _as_int(value: Optional[str], default: int, *, minimum: int, maximum: int) -> int:
    try:
        parsed = int(str(value).strip())
    except Exception:  # noqa: BLE001
        return default
    return max(minimum, min(parsed, maximum))


def _real_secret(value: Optional[str]) -> str:
    if value and value != MASKED_SECRET_VALUE and value.strip():
        return value.strip()
    return ""


class DocumentParseService:
    """Parse complex resources through MinerU, then index Markdown into RAG."""

    async def _get_config_value(self, key: str) -> Optional[str]:
        try:
            config = await SystemConfig.find_one(SystemConfig.key == key)
        except Exception as exc:  # noqa: BLE001
            logger.debug("Document parse config lookup failed for %s: %s", key, exc)
            return None
        if not config or not isinstance(config.value, str):
            return None
        return config.value.strip() or None

    async def get_mineru_config(self) -> MinerUConfig:
        provider = (
            await self._get_config_value("document_parse_provider")
            or settings.DOCUMENT_PARSE_PROVIDER
            or "none"
        ).strip().lower()
        db_token = await self._get_config_value("mineru_api_token")
        api_token = _real_secret(db_token) or settings.MINERU_API_TOKEN
        return MinerUConfig(
            enabled=provider == "mineru" and bool(api_token),
            api_token=api_token,
            base_url=(
                await self._get_config_value("mineru_base_url")
                or settings.MINERU_BASE_URL
            ).rstrip("/"),
            model_version=(
                await self._get_config_value("mineru_model_version")
                or settings.MINERU_MODEL_VERSION
                or "vlm"
            ),
            enable_table=_as_bool(
                await self._get_config_value("mineru_enable_table"),
                settings.MINERU_ENABLE_TABLE,
            ),
            enable_formula=_as_bool(
                await self._get_config_value("mineru_enable_formula"),
                settings.MINERU_ENABLE_FORMULA,
            ),
            is_ocr=_as_bool(
                await self._get_config_value("mineru_is_ocr"),
                settings.MINERU_IS_OCR,
            ),
            language=(
                await self._get_config_value("mineru_language")
                or settings.MINERU_LANGUAGE
                or "ch"
            ),
            poll_interval_seconds=_as_int(
                await self._get_config_value("mineru_poll_interval_seconds"),
                settings.MINERU_POLL_INTERVAL_SECONDS,
                minimum=2,
                maximum=60,
            ),
            timeout_seconds=_as_int(
                await self._get_config_value("mineru_parse_timeout_seconds"),
                settings.MINERU_PARSE_TIMEOUT_SECONDS,
                minimum=60,
                maximum=3600,
            ),
        )

    @staticmethod
    def can_parse_with_mineru(mime_type: str, filename: str = "") -> bool:
        """Return whether MinerU should handle the resource."""
        mime = (mime_type or "").lower()
        name = (filename or "").lower()
        return mime in MINERU_SUPPORTED_MIME_TYPES or name.endswith(
            (".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg", ".webp")
        )

    async def process_resource(self, resource_id: str, *, fallback_text: str = "") -> bool:
        """Parse a resource and index it into RAG."""
        resource = await Resource.get(resource_id)
        if not resource:
            return False

        config = await self.get_mineru_config()
        if not self.can_parse_with_mineru(resource.mime_type, resource.filename):
            resource.parse_status = "unsupported"
            resource.parse_provider = "local"
            resource.parse_error = None
            await resource.save()
            if fallback_text:
                return await rag_service.process_resource(resource_id, fallback_text)
            return False

        if not config.enabled:
            resource.parse_status = "unsupported"
            resource.parse_provider = "mineru"
            resource.parse_error = "MinerU is not configured"
            await resource.save()
            if fallback_text:
                return await rag_service.process_resource(resource_id, fallback_text)
            return False

        resource.parse_status = "parsing"
        resource.parse_provider = "mineru"
        resource.parse_error = None
        await resource.save()

        try:
            markdown, zip_bytes, content_json = await self._parse_with_mineru(resource, config)
            if not markdown:
                raise ValueError("MinerU result did not contain Markdown content")

            base_key = self._parsed_result_prefix(resource)
            markdown_key = f"{base_key}/full.md"
            zip_key = f"{base_key}/mineru_result.zip"
            storage_service.upload_file_bytes(markdown_key, markdown.encode("utf-8"), "text/markdown")
            storage_service.upload_file_bytes(zip_key, zip_bytes, "application/zip")
            resource.parsed_markdown_key = markdown_key
            resource.parsed_zip_key = zip_key
            if content_json:
                content_key = f"{base_key}/content_list.json"
                storage_service.upload_file_bytes(content_key, content_json, "application/json")
                resource.parsed_content_key = content_key
            resource.parse_status = "indexed"
            resource.parse_error = None
            resource.parsed_at = datetime.utcnow()
            await resource.save()
            return await rag_service.process_resource(resource_id, markdown)
        except Exception as exc:  # noqa: BLE001
            logger.warning("MinerU parsing failed for resource %s: %s", resource_id, exc)
            resource.parse_status = "failed"
            resource.parse_error = str(exc)[:1000]
            await resource.save()
            if fallback_text:
                return await rag_service.process_resource(resource_id, fallback_text)
            return False

    @staticmethod
    def _parsed_result_prefix(resource: Resource) -> str:
        if resource.scope == "course" and resource.course_id:
            return f"courses/{resource.course_id}/parsed/{resource.id}"
        return f"projects/{resource.project_id}/parsed/{resource.id}"

    async def _parse_with_mineru(self, resource: Resource, config: MinerUConfig) -> tuple[str, bytes, Optional[bytes]]:
        file_url = storage_service.generate_presigned_get_url(
            resource.file_key,
            expires_in=max(config.timeout_seconds + 600, 1800),
        )
        api_base = self._api_base_url(config.base_url)
        headers = {
            "Authorization": f"Bearer {config.api_token}",
            "Content-Type": "application/json",
        }
        payload = {
            "url": file_url,
            "model_version": config.model_version,
            "enable_table": config.enable_table,
            "enable_formula": config.enable_formula,
            "is_ocr": config.is_ocr,
            "language": config.language,
            "data_id": str(resource.id),
        }
        async with httpx.AsyncClient(timeout=30) as client:
            create_response = await client.post(
                f"{api_base}/extract/task",
                json=payload,
                headers=headers,
            )
            create_response.raise_for_status()
            create_data = create_response.json()
            if create_data.get("code") != 0:
                raise ValueError(create_data.get("msg") or "MinerU task creation failed")
            task_id = (create_data.get("data") or {}).get("task_id")
            if not task_id:
                raise ValueError("MinerU response did not include task_id")

            resource.parse_task_id = task_id
            await resource.save()

            deadline = asyncio.get_running_loop().time() + config.timeout_seconds
            result_data = None
            while asyncio.get_running_loop().time() < deadline:
                await asyncio.sleep(config.poll_interval_seconds)
                result_response = await client.get(
                    f"{api_base}/extract/task/{task_id}",
                    headers=headers,
                )
                result_response.raise_for_status()
                result_json = result_response.json()
                if result_json.get("code") != 0:
                    raise ValueError(result_json.get("msg") or "MinerU task query failed")
                result_data = result_json.get("data") or {}
                state = str(result_data.get("state") or result_data.get("status") or "").lower()
                if state in {"done", "success", "finished", "completed"}:
                    break
                if state in {"failed", "fail", "error"}:
                    raise ValueError(result_data.get("err_msg") or "MinerU task failed")
            else:
                raise TimeoutError("MinerU parsing timed out")

            final_state = str((result_data or {}).get("state") or (result_data or {}).get("status") or "").lower()
            if not result_data or final_state not in {"done", "success", "finished", "completed"}:
                raise ValueError("MinerU task did not finish")
            zip_url = (
                result_data.get("full_zip_url")
                or result_data.get("zip_url")
                or (result_data.get("result") or {}).get("full_zip_url")
            )
            if not zip_url:
                raise ValueError("MinerU result did not include full_zip_url")

            zip_response = await client.get(zip_url, timeout=120)
            zip_response.raise_for_status()
            zip_bytes = zip_response.content

        markdown, content_json = self._extract_mineru_zip(zip_bytes)
        return markdown, zip_bytes, content_json

    @staticmethod
    def _api_base_url(base_url: str) -> str:
        """Normalize MinerU base URL to the /api/v4 root."""
        base = (base_url or "https://mineru.net").strip().rstrip("/")
        if base.endswith("/api/v4/extract/task"):
            return base[: -len("/extract/task")]
        if base.endswith("/api/v4"):
            return base
        return f"{base}/api/v4"

    @staticmethod
    def _extract_mineru_zip(zip_bytes: bytes) -> tuple[str, Optional[bytes]]:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
            names = archive.namelist()
            markdown_name = next((name for name in names if name.endswith("full.md")), None)
            if not markdown_name:
                markdown_name = next((name for name in names if name.lower().endswith(".md")), None)
            if not markdown_name:
                raise ValueError("MinerU zip has no Markdown file")
            markdown = archive.read(markdown_name).decode("utf-8", errors="ignore").strip()
            content_name = next((name for name in names if name.endswith("_content_list.json") or name.endswith("content_list.json")), None)
            content_json = archive.read(content_name) if content_name else None
            return markdown, content_json

    async def test_mineru_config(self) -> dict:
        """Return a non-invasive MinerU connectivity check."""
        config = await self.get_mineru_config()
        if not config.enabled:
            return {
                "success": False,
                "service": "document_parse",
                "error": "MinerU 未启用或 API Token 未配置。",
                "config": self.safe_summary(config),
            }
        try:
            api_base = self._api_base_url(config.base_url)
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.get(
                    f"{api_base}/extract/task/aiscl-connectivity-test",
                    headers={"Authorization": f"Bearer {config.api_token}", "Accept": "*/*"},
                )
            # A valid token commonly returns a structured not-found response for a fake task.
            if response.status_code in {200, 404}:
                return {
                    "success": True,
                    "service": "document_parse",
                    "response_preview": "MinerU API reachable",
                    "config": self.safe_summary(config),
                }
            return {
                "success": False,
                "service": "document_parse",
                "error": f"MinerU 返回 HTTP {response.status_code}",
                "config": self.safe_summary(config),
            }
        except Exception as exc:  # noqa: BLE001
            return {
                "success": False,
                "service": "document_parse",
                "error": str(exc),
                "config": self.safe_summary(config),
            }

    @staticmethod
    def safe_summary(config: MinerUConfig) -> dict:
        return {
            "provider": "mineru" if config.enabled else "none",
            "base_url": config.base_url,
            "model": config.model_version,
            "has_key": bool(config.api_token),
            "enabled": config.enabled,
        }


document_parse_service = DocumentParseService()
