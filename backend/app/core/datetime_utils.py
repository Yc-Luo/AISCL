"""Datetime helpers for API serialization and user-facing labels."""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo


CHINA_TZ = ZoneInfo("Asia/Shanghai")


def ensure_aware_utc(value: datetime) -> datetime:
    """Treat naive datetimes from Mongo as UTC and return an aware UTC datetime."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def utc_isoformat(value: datetime | None) -> str | None:
    """Serialize datetimes with an explicit UTC marker so browsers parse them correctly."""
    if value is None:
        return None
    return ensure_aware_utc(value).isoformat(timespec="microseconds").replace("+00:00", "Z")


def china_datetime_label(value: datetime | None) -> str:
    """Format a datetime for Chinese user-facing text."""
    if value is None:
        return "未设置"
    return ensure_aware_utc(value).astimezone(CHINA_TZ).strftime("%Y-%m-%d %H:%M")
