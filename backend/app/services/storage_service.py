"""Storage service for file uploads (MinIO/S3)."""

import logging
from datetime import timedelta
from typing import Optional

from minio import Minio
from minio.error import S3Error

from app.core.config import settings


logger = logging.getLogger(__name__)


class StorageService:
    """Storage service for object storage operations."""

    def __init__(self):
        """Initialize storage client."""
        self._bucket_checked = False
        if settings.STORAGE_TYPE == "minio":
            self.client = Minio(
                settings.MINIO_ENDPOINT,
                access_key=settings.MINIO_ACCESS_KEY,
                secret_key=settings.MINIO_SECRET_KEY,
                secure=settings.MINIO_USE_SSL,
                region="us-east-1",
            )
            
            # Create a separate client for signing URLs if public endpoint differs
            # This ensures the signature matches the host header sent by the browser
            if settings.MINIO_ENDPOINT != settings.MINIO_PUBLIC_ENDPOINT:
                self.signer_client = Minio(
                    settings.MINIO_PUBLIC_ENDPOINT,
                    access_key=settings.MINIO_ACCESS_KEY,
                    secret_key=settings.MINIO_SECRET_KEY,
                    secure=settings.MINIO_USE_SSL,
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
