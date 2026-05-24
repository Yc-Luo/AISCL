# syntax=docker/dockerfile:1.7

# Lightweight backend image. The heavy runtime and dependency layers come from
# BACKEND_BASE_IMAGE, so normal application-code changes only copy source.
ARG BACKEND_BASE_IMAGE=ghcr.io/yc-luo/aiscl-backend-base:latest
FROM ${BACKEND_BASE_IMAGE} AS production

WORKDIR /app

COPY --chown=AISCL:AISCL . .
RUN mkdir -p /app/data && chown AISCL:AISCL /app/data

USER AISCL

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
