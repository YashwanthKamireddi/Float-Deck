"""Centralized settings for FloatAI backend.

Uses Pydantic settings (v1 or v2-compatible) to keep configuration typed and
overrideable via environment variables or a .env file.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Optional

try:  # Pydantic v2 style via pydantic-settings if available
    from pydantic_settings import BaseSettings
except ImportError:  # Fallback to pydantic v1 BaseSettings
    try:
        from pydantic import BaseSettings  # type: ignore
    except ImportError as exc:  # pragma: no cover - defensive guard
        raise RuntimeError("pydantic is required for configuration parsing.") from exc

from pydantic import Field


class Settings(BaseSettings):
    google_api_key: str = Field(..., env="GOOGLE_API_KEY")

    database_url: Optional[str] = Field(None, env="DATABASE_URL")
    db_user: str = Field("postgres", env="DB_USER")
    db_password: Optional[str] = Field(None, env="DB_PASSWORD")
    db_host: str = Field("localhost", env="DB_HOST")
    db_port: str = Field("5432", env="DB_PORT")
    db_name: str = Field("float", env="DB_NAME")

    faiss_index_path: Optional[str] = Field(None, env="FAISS_INDEX_PATH")
    rag_retriever_k: int = Field(6, env="RAG_RETRIEVER_K")
    query_timeout_ms: int = Field(15000, env="QUERY_TIMEOUT_MS")

    api_shared_key: Optional[str] = Field(None, env="API_SHARED_KEY")
    rate_limit_per_minute: int = Field(60, env="RATE_LIMIT_PER_MINUTE")
    cors_origins: Optional[str] = Field(None, env="BACKEND_CORS_ORIGINS")

    embeddings_model: str = Field("sentence-transformers/all-MiniLM-L6-v2", env="EMBEDDINGS_MODEL")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False
        extra = "ignore"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[arg-type]
