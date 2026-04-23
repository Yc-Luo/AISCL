"""Monitoring and metrics utilities."""

import time
from typing import Dict, Any, Optional
from contextlib import asynccontextmanager

from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from fastapi import Request, Response
from fastapi.responses import PlainTextResponse

# Request metrics
REQUEST_COUNT = Counter(
    'http_requests_total',
    'Total number of HTTP requests',
    ['method', 'endpoint', 'status_code']
)

REQUEST_LATENCY = Histogram(
    'http_request_duration_seconds',
    'HTTP request duration in seconds',
    ['method', 'endpoint']
)

# Business metrics
ACTIVE_USERS = Gauge(
    'active_users_total',
    'Number of active users'
)

ACTIVE_PROJECTS = Gauge(
    'active_projects_total',
    'Number of active projects'
)

WEBSOCKET_CONNECTIONS = Gauge(
    'websocket_connections_total',
    'Number of active WebSocket connections'
)

AI_REQUESTS = Counter(
    'ai_requests_total',
    'Total number of AI requests',
    ['provider', 'model', 'status']
)

# Database metrics
DB_QUERY_COUNT = Counter(
    'db_queries_total',
    'Total number of database queries',
    ['operation', 'collection']
)

DB_QUERY_LATENCY = Histogram(
    'db_query_duration_seconds',
    'Database query duration in seconds',
    ['operation', 'collection']
)

# Cache metrics
CACHE_HITS = Counter(
    'cache_hits_total',
    'Total number of cache hits',
    ['cache_type']
)

CACHE_MISSES = Counter(
    'cache_misses_total',
    'Total number of cache misses',
    ['cache_type']
)


@asynccontextmanager
async def measure_db_query(operation: str, collection: str):
    """Context manager to measure database query performance."""
    start_time = time.time()
    try:
        yield
    finally:
        duration = time.time() - start_time
        DB_QUERY_LATENCY.labels(operation=operation, collection=collection).observe(duration)
        DB_QUERY_COUNT.labels(operation=operation, collection=collection).inc()


async def track_request_metrics(request: Request, response: Response, duration: float):
    """Track HTTP request metrics."""
    REQUEST_COUNT.labels(
        method=request.method,
        endpoint=request.url.path,
        status_code=response.status_code
    ).inc()

    REQUEST_LATENCY.labels(
        method=request.method,
        endpoint=request.url.path
    ).observe(duration)


async def metrics_endpoint() -> PlainTextResponse:
    """Prometheus metrics endpoint."""
    return PlainTextResponse(
        generate_latest(),
        media_type=CONTENT_TYPE_LATEST
    )


class PerformanceMonitor:
    """Performance monitoring utilities."""

    @staticmethod
    async def track_ai_request(provider: str, model: str, status: str = "success"):
        """Track AI API requests."""
        AI_REQUESTS.labels(provider=provider, model=model, status=status).inc()

    @staticmethod
    async def update_active_users(count: int):
        """Update active users gauge."""
        ACTIVE_USERS.set(count)

    @staticmethod
    async def update_active_projects(count: int):
        """Update active projects gauge."""
        ACTIVE_PROJECTS.set(count)

    @staticmethod
    async def update_websocket_connections(count: int):
        """Update WebSocket connections gauge."""
        WEBSOCKET_CONNECTIONS.set(count)

    @staticmethod
    async def track_cache_hit(cache_type: str):
        """Track cache hit."""
        CACHE_HITS.labels(cache_type=cache_type).inc()

    @staticmethod
    async def track_cache_miss(cache_type: str):
        """Track cache miss."""
        CACHE_MISSES.labels(cache_type=cache_type).inc()

    @staticmethod
    async def get_cache_stats() -> Dict[str, Any]:
        """Get cache performance statistics."""
        return {
            "cache_hits": CACHE_HITS._value.sum(),
            "cache_misses": CACHE_MISSES._value.sum(),
        }


# Global monitor instance
monitor = PerformanceMonitor()

