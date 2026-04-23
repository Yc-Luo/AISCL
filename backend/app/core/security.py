"""Security utilities and middleware."""

from typing import Optional

from fastapi import Request, HTTPException, status
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Rate limiter
limiter = Limiter(key_func=get_remote_address)


def setup_rate_limiting(app):
    """Setup rate limiting middleware."""
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    return app


def sanitize_input(text: str) -> str:
    """Sanitize user input to prevent XSS."""
    import html

    # HTML escape
    sanitized = html.escape(text)

    # Remove script tags
    import re

    sanitized = re.sub(r"<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>", "", sanitized, flags=re.IGNORECASE)

    return sanitized


def validate_mongodb_query(query: dict) -> bool:
    """Validate MongoDB query to prevent injection."""
    # Check for dangerous operators
    dangerous_operators = ["$where", "$eval", "$function", "$constructor"]
    query_str = str(query)
    for op in dangerous_operators:
        if op in query_str:
            return False
    return True


def validate_password_strength(password: str) -> tuple[bool, str]:
    """Validate password strength.

    Args:
        password: The password to validate

    Returns:
        Tuple of (is_valid, error_message)
    """
    if len(password) < 8:
        return False, "Password must be at least 8 characters long"

    if not any(char.isupper() for char in password):
        return False, "Password must contain at least one uppercase letter"

    if not any(char.islower() for char in password):
        return False, "Password must contain at least one lowercase letter"

    if not any(char.isdigit() for char in password):
        return False, "Password must contain at least one digit"

    return True, ""


def sanitize_filename(filename: str) -> str:
    """Sanitize filename to prevent path traversal attacks."""
    import re

    # Remove dangerous characters
    sanitized = re.sub(r'[<>:"/\\|?*]', '', filename)

    # Remove leading/trailing dots and spaces
    sanitized = sanitized.strip('. ')

    # Limit length
    if len(sanitized) > 255:
        sanitized = sanitized[:255]

    # Ensure it's not empty
    if not sanitized:
        sanitized = "unnamed_file"

    return sanitized


def validate_file_type(filename: str, allowed_extensions: list[str]) -> bool:
    """Validate file type by extension."""
    if not filename:
        return False

    import os
    _, ext = os.path.splitext(filename.lower())

    return ext in [e.lower() for e in allowed_extensions]


def get_csp_header() -> str:
    """Get Content Security Policy header."""
    return (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "  # Keep for CSS frameworks
        "img-src 'self' data: https: blob: *; "
        "font-src 'self' data: https://fonts.gstatic.com; "
        "connect-src 'self' ws: wss: http://localhost:9000 http://127.0.0.1:9000 http://minio:9000 *; "
        "frame-src 'self' https:; "
        "frame-ancestors 'none'; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self';"
    )
