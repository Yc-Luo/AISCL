"""Lightweight text extraction for uploaded learning resources."""

import csv
import io
import json
import re
from typing import Optional

from bs4 import BeautifulSoup


class TextExtractionService:
    """Extract plain text from lightweight resource formats."""

    TEXT_MIME_PREFIXES = ("text/",)
    TEXT_MIME_TYPES = {
        "application/json",
        "application/xml",
        "application/xhtml+xml",
        "application/csv",
        "text/csv",
        "text/markdown",
    }

    @staticmethod
    def can_extract(mime_type: str, filename: Optional[str] = None) -> bool:
        """Return whether this file type can be indexed without heavy dependencies."""
        mime = (mime_type or "").lower()
        name = (filename or "").lower()
        return (
            mime.startswith(TextExtractionService.TEXT_MIME_PREFIXES)
            or mime in TextExtractionService.TEXT_MIME_TYPES
            or name.endswith((".txt", ".md", ".markdown", ".csv", ".json", ".html", ".htm"))
        )

    @staticmethod
    def extract_text(file_bytes: bytes, mime_type: str, filename: str) -> str:
        """Extract text from supported lightweight resource formats."""
        if not file_bytes:
            return ""

        text = file_bytes.decode("utf-8", errors="ignore")
        mime = (mime_type or "").lower()
        name = (filename or "").lower()

        if "json" in mime or name.endswith(".json"):
            try:
                data = json.loads(text)
                return json.dumps(data, ensure_ascii=False, indent=2)
            except Exception:
                return TextExtractionService._clean_text(text)

        if "csv" in mime or name.endswith(".csv"):
            return TextExtractionService._extract_csv_text(text)

        if "html" in mime or name.endswith((".html", ".htm")):
            soup = BeautifulSoup(text, "html.parser")
            return TextExtractionService._clean_text(soup.get_text("\n"))

        return TextExtractionService._clean_text(text)

    @staticmethod
    def _extract_csv_text(text: str) -> str:
        """Convert small CSV files to line-based text for indexing."""
        rows = []
        reader = csv.reader(io.StringIO(text))
        for index, row in enumerate(reader):
            if index >= 200:
                break
            rows.append(" | ".join(cell.strip() for cell in row if cell.strip()))
        return TextExtractionService._clean_text("\n".join(rows))

    @staticmethod
    def _clean_text(text: str) -> str:
        """Normalize whitespace while preserving paragraph boundaries."""
        text = re.sub(r"\r\n?", "\n", text or "")
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()


text_extraction_service = TextExtractionService()
