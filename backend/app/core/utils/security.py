"""Security utilities."""

import hashlib


def hash_string(text: str) -> str:
    """Hash a string using SHA256."""
    return hashlib.sha256(text.encode()).hexdigest()

