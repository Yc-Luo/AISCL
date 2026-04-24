"""Application configuration using pydantic-settings."""

from typing import List, Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    APP_NAME: str = "AISCL"
    APP_ENV: str = "development"
    DEBUG: bool = True
    LOG_LEVEL: str = "INFO"
    SECRET_KEY: str = Field(..., min_length=32)

    # Database
    MONGODB_URI: str = "mongodb://localhost:27017/AISCL"
    MONGODB_DB_NAME: str = "AISCL"
    MONGODB_MAX_POOL_SIZE: int = 10

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # JWT
    JWT_SECRET_KEY: str = Field(..., min_length=32)
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # Storage
    STORAGE_TYPE: str = "minio"
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin123"
    MINIO_BUCKET_NAME: str = "aiscl-files"
    MINIO_PUBLIC_ENDPOINT: str = "localhost:9000"
    MINIO_USE_SSL: bool = False

    # AI Configuration
    LLM_CONFIG_SOURCE: str = "env"
    LLM_PROVIDER: str = "deepseek"
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"
    OPENAI_BASE_URL: str = ""
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "llama3"

    # DeepSeek
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_MODEL: str = "deepseek-chat"
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com"

    # Embedding and vector retrieval
    RAG_VECTOR_ENABLED: bool = True
    EMBEDDING_PROVIDER: str = "minimax"
    MINIMAX_API_KEY: str = ""
    MINIMAX_GROUP_ID: str = ""
    MINIMAX_EMBEDDING_MODEL: str = "embo-01"
    MINIMAX_EMBEDDING_BASE_URL: str = "https://api.minimax.chat/v1/embeddings"
    MINIMAX_EMBEDDING_TYPE: str = "db"
    QDRANT_URL: str = "http://qdrant:6333"
    QDRANT_API_KEY: Optional[str] = None
    QDRANT_COLLECTION: str = "aiscl_rag"
    QDRANT_VECTOR_SIZE: int = 1536
    RAG_CHUNK_SIZE: int = 900
    RAG_CHUNK_OVERLAP: int = 120

    # CORS
    CORS_ORIGINS: List[str] = Field(
        default=["http://localhost:5173", "http://localhost:3000"]
    )

    # File Upload
    MAX_FILE_SIZE: int = 52428800  # 50MB
    MAX_PROJECT_STORAGE: int = 5368709120  # 5GB

    # Project Limits
    MAX_PROJECT_MEMBERS: int = 5

    # CDN Configuration
    CDN_BASE_URL: Optional[str] = None  # CDN base URL for file serving


settings = Settings()
