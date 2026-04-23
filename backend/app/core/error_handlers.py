"""Global error handlers for FastAPI application."""

import logging
from typing import Union

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

logger = logging.getLogger(__name__)


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Handle HTTP exceptions with proper logging and response formatting."""
    logger.warning(
        f"HTTP Exception: {exc.status_code} - {exc.detail} "
        f"(Path: {request.url.path}, Method: {request.method}, Client: {request.client.host})"
    )

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.status_code,
                "message": exc.detail,
                "type": "http_exception"
            }
        }
    )


async def validation_exception_handler(request: Request, exc: ValidationError) -> JSONResponse:
    """Handle Pydantic validation errors."""
    try:
        from fastapi.encoders import jsonable_encoder
        error_details = jsonable_encoder(exc.errors())
    except Exception:
        # Fallback if serialization fails
        error_details = [{"message": str(exc)}]

    logger.warning(
        f"Validation Error: {error_details} "
        f"(Path: {request.url.path}, Method: {request.method})"
    )

    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": 422,
                "message": "Validation error",
                "type": "validation_error",
                "details": error_details
            }
        }
    )


async def request_validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Handle FastAPI Request Validation errors."""
    try:
        from fastapi.encoders import jsonable_encoder
        error_details = jsonable_encoder(exc.errors())
        body = exc.body
    except Exception:
        error_details = [{"message": str(exc)}]
        body = "Could not parse body"

    logger.warning(
        f"Request Validation Error: {error_details} "
        f"(Path: {request.url.path}, Method: {request.method}, Body: {body})"
    )

    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": 422,
                "message": "Request validation error",
                "type": "request_validation_error",
                "details": error_details
            }
        }
    )


async def general_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Handle general exceptions with proper logging."""
    logger.error(
        f"Unhandled Exception: {type(exc).__name__}: {str(exc)} "
        f"(Path: {request.url.path}, Method: {request.method}, Client: {request.client.host})",
        exc_info=True
    )

    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": 500,
                "message": "Internal server error",
                "type": "internal_error"
            }
        }
    )


def setup_error_handlers(app):
    """Setup global error handlers for the FastAPI application."""

    # Add exception handlers
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(ValidationError, validation_exception_handler)
    app.add_exception_handler(RequestValidationError, request_validation_exception_handler)
    app.add_exception_handler(Exception, general_exception_handler)

    logger.info("Global error handlers configured")

