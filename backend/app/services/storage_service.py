"""Storage service for file uploads (MinIO/S3)."""

import logging
from datetime import timedelta
from typing import Optional
from urllib.parse import urlparse

from minio import Minio
from minio.error import S3Error

from app.core.config import settings


logger = logging.getLogger(__name__)


def _parse_minio_endpoint(endpoint: str, default_secure: bool) -> tuple[str, bool]:
    """Normalize MinIO endpoint config for the SDK.

    The MinIO client expects only host[:port]. Deployment docs may use a public
    URL for readability, so tolerate http(s)://host but still reject path-based
    endpoints because MinIO signs bucket/object paths itself.
    """
    raw_endpoint = (endpoint or "").strip().rstrip("/")
    if "://" not in raw_endpoint:
        return raw_endpoint, default_secure

    parsed = urlparse(raw_endpoint)
    if parsed.path and parsed.path != "/":
        raise ValueError(
            "MINIO endpoint must not include a path. Use host[:port] only."
        )
    if not parsed.netloc:
        raise ValueError("MINIO endpoint is invalid.")
    return parsed.netloc, parsed.scheme == "https"


class StorageService:
    """Storage service for object storage operations."""

    def __init__(self):
        """Initialize storage client."""
        self._bucket_checked = False
        if settings.STORAGE_TYPE == "minio":
            internal_endpoint, internal_secure = _parse_minio_endpoint(
                settings.MINIO_ENDPOINT, settings.MINIO_USE_SSL
            )
            public_endpoint, public_secure = _parse_minio_endpoint(
                settings.MINIO_PUBLIC_ENDPOINT, settings.MINIO_USE_SSL
            )
            self.client = Minio(
                internal_endpoint,
                access_key=settings.MINIO_ACCESS_KEY,
                secret_key=settings.MINIO_SECRET_KEY,
                secure=internal_secure,
                region="us-east-1",
            )
            
            # Create a separate client for signing URLs if public endpoint differs
            # This ensures the signature matches the host header sent by the browser
            if (internal_endpoint, internal_secure) != (public_endpoint, public_secure):
                self.signer_client = Minio(
                    public_endpoint,
                    access_key=settings.MINIO_ACCESS_KEY,
                    secret_key=settings.MINIO_SECRET_KEY,
                    secure=public_secure,
                    region="us-east-1",
                )
            else:
                self.signer_client = self.client

            self._ensure_bucket_exists()
        else:
            # TODO: Add S3 support
            self.client = None
            self.signer_client = None

    def _ensure_bucket_exists(self):
        """Ensure bucket exists."""
        if not self.client or self._bucket_checked:
            return

        try:
            if not self.client.bucket_exists(settings.MINIO_BUCKET_NAME):
                self.client.make_bucket(settings.MINIO_BUCKET_NAME)
            self._bucket_checked = True
        except Exception as e:  # noqa: BLE001
            logger.warning("Storage bucket check skipped during startup: %s", e)

    def generate_presigned_put_url(
        self, file_key: str, expires_in: int = 300
    ) -> str:
        """Generate presigned PUT URL for file upload."""
        if not self.signer_client:
            raise ValueError("Storage client not initialized")

        self._ensure_bucket_exists()

        try:
            url = self.signer_client.presigned_put_object(
                settings.MINIO_BUCKET_NAME,
                file_key,
                expires=timedelta(seconds=expires_in),
            )
            return url
        except S3Error as e:
            raise ValueError(f"Failed to generate presigned URL: {e}")

    def generate_presigned_get_url(
        self, file_key: str, expires_in: int = 3600, use_cdn: bool = False
    ) -> str:
        """Generate presigned GET URL for file download.

        Args:
            file_key: File key in storage
            expires_in: URL expiration time in seconds
            use_cdn: Whether to use CDN URL (if configured)

        Returns:
            Presigned URL or CDN URL
        """
        # Check if CDN is configured and enabled
        if use_cdn and hasattr(settings, "CDN_BASE_URL") and settings.CDN_BASE_URL:
            # Generate CDN signed URL
            # For production, this would use CDN provider's signing mechanism
            # For now, return CDN URL directly
            return f"{settings.CDN_BASE_URL}/{file_key}"

        if not self.signer_client:
            raise ValueError("Storage client not initialized")

        self._ensure_bucket_exists()

        try:
            url = self.signer_client.presigned_get_object(
                settings.MINIO_BUCKET_NAME,
                file_key,
                expires=timedelta(seconds=expires_in),
            )
            return url
        except S3Error as e:
            raise ValueError(f"Failed to generate presigned URL: {e}")

    def generate_url(self, file_key: str, use_cdn: bool = False) -> str:
        """Generate URL for file access (abstracted method for CDN support).

        Args:
            file_key: File key in storage
            use_cdn: Whether to use CDN URL

        Returns:
            File URL
        """
        return self.generate_presigned_get_url(file_key, use_cdn=use_cdn)

    def delete_file(self, file_key: str) -> bool:
        """Delete a file from storage."""
        if not self.client:
            return False

        self._ensure_bucket_exists()

        try:
            self.client.remove_object(settings.MINIO_BUCKET_NAME, file_key)
            return True
        except S3Error:
            return False

    def get_file_bytes(self, file_key: str) -> bytes:
        """Download file bytes from object storage."""
        if not self.client:
            raise ValueError("Storage client not initialized")

        self._ensure_bucket_exists()

        response = None
        try:
            response = self.client.get_object(settings.MINIO_BUCKET_NAME, file_key)
            return response.read()
        except S3Error as e:
            raise ValueError(f"Failed to download file: {e}")
        finally:
            if response is not None:
                response.close()
                response.release_conn()

    def get_file_size(self, file_key: str) -> Optional[int]:
        """Get file size."""
        if not self.client:
            return None

        self._ensure_bucket_exists()

        try:
            stat = self.client.stat_object(settings.MINIO_BUCKET_NAME, file_key)
            return stat.size
        except S3Error:
            return None


storage_service = StorageService()
