"""Controlled web search fallback for RAG.

This service is intentionally server-side and opt-in. It is not a Codex MCP
bridge. The deployed AISCL app calls only the search provider configured by an
administrator, then passes short snippets back into the normal RAG context.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import httpx

from app.core.config import settings
from app.repositories.system_config import SystemConfig


MASKED_SECRET_VALUE = "********"
PLATFORM_OPERATION_TERMS = {
    "aiscl",
    "平台",
    "系统",
    "按钮",
    "页面",
    "页签",
    "上传",
    "提交",
    "登录",
    "资源库",
    "wiki",
    "知识沉淀",
    "协作文档",
    "论证空间",
    "教师支持",
    "怎么用",
    "如何使用",
}


@dataclass
class WebSearchConfig:
    enabled: bool
    provider: str
    api_key: str
    base_url: str
    max_results: int


def _as_bool(value: Optional[str], default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on", "enabled"}


def _as_int(value: Optional[str], default: int) -> int:
    try:
        parsed = int(str(value).strip())
    except Exception:  # noqa: BLE001
        return default
    return max(1, min(parsed, 10))


def _clean_text(value: Any, max_chars: int = 600) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "..."


class WebSearchService:
    """Provider adapters for optional search grounding."""

    async def get_config(self) -> WebSearchConfig:
        keys = [
            "web_search_enabled",
            "web_search_provider",
            "web_search_key",
            "web_search_base_url",
            "web_search_max_results",
        ]
        db_values: Dict[str, Optional[str]] = {}
        for key in keys:
            config = await SystemConfig.find_one(SystemConfig.key == key)
            db_values[key] = config.value.strip() if config and isinstance(config.value, str) else None

        api_key = db_values.get("web_search_key") or settings.WEB_SEARCH_API_KEY
        if api_key == MASKED_SECRET_VALUE:
            api_key = settings.WEB_SEARCH_API_KEY

        return WebSearchConfig(
            enabled=_as_bool(db_values.get("web_search_enabled"), settings.WEB_SEARCH_ENABLED),
            provider=(db_values.get("web_search_provider") or settings.WEB_SEARCH_PROVIDER or "searxng").strip().lower(),
            api_key=api_key or "",
            base_url=(db_values.get("web_search_base_url") or settings.WEB_SEARCH_BASE_URL or "").strip(),
            max_results=_as_int(db_values.get("web_search_max_results"), settings.WEB_SEARCH_MAX_RESULTS),
        )

    @staticmethod
    def should_search(query: str) -> bool:
        """Avoid web search for platform-operation questions and very short prompts."""
        normalized = re.sub(r"\s+", "", (query or "").lower())
        if len(normalized) < 8:
            return False
        return not any(term.lower() in normalized for term in PLATFORM_OPERATION_TERMS)

    async def is_enabled(self) -> bool:
        config = await self.get_config()
        return config.enabled and bool(config.base_url or config.provider in {"brave", "bing", "serpapi", "tavily"})

    async def search(self, query: str, *, max_results: Optional[int] = None) -> List[Dict[str, Any]]:
        config = await self.get_config()
        if not config.enabled or not self.should_search(query):
            return []

        limit = min(max_results or config.max_results, config.max_results, 5)
        provider = config.provider
        if provider == "tavily":
            return await self._search_tavily(query, config, limit)
        if provider == "brave":
            return await self._search_brave(query, config, limit)
        if provider == "bing":
            return await self._search_bing(query, config, limit)
        if provider == "serpapi":
            return await self._search_serpapi(query, config, limit)
        return await self._search_searxng(query, config, limit)

    async def test_search(self) -> Dict[str, Any]:
        config = await self.get_config()
        if not config.enabled:
            return {
                "success": False,
                "service": "web_search",
                "error": "联网搜索未启用。请先打开 web_search_enabled。",
                "config": self.safe_summary(config),
            }
        results = await self.search("AISCL web search connectivity test", max_results=2)
        if not results:
            return {
                "success": False,
                "service": "web_search",
                "error": "未返回搜索结果。请检查 Provider、Base URL、API Key 或服务网络。",
                "config": self.safe_summary(config),
            }
        return {
            "success": True,
            "service": "web_search",
            "response_preview": results[0].get("title") or results[0].get("content", "")[:80],
            "result_count": len(results),
            "config": self.safe_summary(config),
        }

    @staticmethod
    def safe_summary(config: WebSearchConfig) -> Dict[str, Any]:
        return {
            "provider": config.provider,
            "base_url": config.base_url,
            "model": None,
            "has_key": bool(config.api_key),
            "max_results": config.max_results,
            "enabled": config.enabled,
        }

    @staticmethod
    def _normalize_results(raw_results: List[Dict[str, Any]], *, provider: str, limit: int) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        for index, item in enumerate(raw_results[:limit]):
            title = _clean_text(item.get("title") or item.get("name") or item.get("url"), 180)
            url = str(item.get("url") or item.get("link") or "").strip()
            snippet = _clean_text(
                item.get("content") or item.get("snippet") or item.get("description") or item.get("body"),
                700,
            )
            if not title and not snippet:
                continue
            results.append({
                "id": url or f"{provider}:{index}",
                "type": "web",
                "title": title or "网页搜索结果",
                "source_type": "web_search",
                "content": snippet,
                "url": url,
                "score": float(item.get("score") or item.get("rank") or max(0.1, 1 - index * 0.08)),
                "provider": provider,
                "citation_source": provider,
            })
        return results

    async def _search_searxng(self, query: str, config: WebSearchConfig, limit: int) -> List[Dict[str, Any]]:
        if not config.base_url:
            return []
        url = urljoin(config.base_url.rstrip("/") + "/", "search")
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.get(
                url,
                params={"q": query, "format": "json", "language": "zh-CN", "categories": "general"},
            )
            response.raise_for_status()
            data = response.json()
        return self._normalize_results(data.get("results") or [], provider="searxng", limit=limit)

    async def _search_tavily(self, query: str, config: WebSearchConfig, limit: int) -> List[Dict[str, Any]]:
        if not config.api_key:
            return []
        url = config.base_url or "https://api.tavily.com/search"
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                url,
                json={
                    "api_key": config.api_key,
                    "query": query,
                    "max_results": limit,
                    "search_depth": "basic",
                    "include_answer": False,
                },
            )
            response.raise_for_status()
            data = response.json()
        return self._normalize_results(data.get("results") or [], provider="tavily", limit=limit)

    async def _search_brave(self, query: str, config: WebSearchConfig, limit: int) -> List[Dict[str, Any]]:
        if not config.api_key:
            return []
        url = config.base_url or "https://api.search.brave.com/res/v1/web/search"
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.get(
                url,
                headers={"X-Subscription-Token": config.api_key, "Accept": "application/json"},
                params={"q": query, "count": limit},
            )
            response.raise_for_status()
            data = response.json()
        return self._normalize_results((data.get("web") or {}).get("results") or [], provider="brave", limit=limit)

    async def _search_bing(self, query: str, config: WebSearchConfig, limit: int) -> List[Dict[str, Any]]:
        if not config.api_key:
            return []
        url = config.base_url or "https://api.bing.microsoft.com/v7.0/search"
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.get(
                url,
                headers={"Ocp-Apim-Subscription-Key": config.api_key},
                params={"q": query, "count": limit, "mkt": "zh-CN"},
            )
            response.raise_for_status()
            data = response.json()
        return self._normalize_results((data.get("webPages") or {}).get("value") or [], provider="bing", limit=limit)

    async def _search_serpapi(self, query: str, config: WebSearchConfig, limit: int) -> List[Dict[str, Any]]:
        if not config.api_key:
            return []
        url = config.base_url or "https://serpapi.com/search.json"
        async with httpx.AsyncClient(timeout=12.0) as client:
            response = await client.get(
                url,
                params={"engine": "google", "q": query, "api_key": config.api_key, "num": limit, "hl": "zh-cn"},
            )
            response.raise_for_status()
            data = response.json()
        return self._normalize_results(data.get("organic_results") or [], provider="serpapi", limit=limit)


web_search_service = WebSearchService()
