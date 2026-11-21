"""Application configuration.

All configuration comes from environment variables (or a local, git-ignored `.env`).
No secret has a default value. Production settings are validated at startup so a
misconfigured deployment fails fast instead of running insecurely.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

Environment = Literal["development", "test", "staging", "production"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    environment: Environment = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    api_prefix: str = "/api/v1"
    expose_docs: bool = False

    # Database (Supabase Postgres). Use the Supavisor *session* pooler URL (port 5432)
    # on Render: the direct connection host is IPv6-only.
    database_url: SecretStr | None = None
    database_ssl: bool = True
    database_pool_size: int = Field(default=5, ge=1, le=50)
    database_max_overflow: int = Field(default=5, ge=0, le=50)

    # Browser origins allowed to call the API. Comma-separated in the environment.
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)

    # Supabase (required from Phase 1 onwards; declared now so templates are complete).
    supabase_url: str | None = None
    supabase_secret_key: SecretStr | None = None
    supabase_jwt_issuer: str | None = None
    supabase_jwks_url: str | None = None

    # Background jobs. On Render Free the runner lives inside the API process.
    run_jobs_in_process: bool = False

    # AI provider layer: "none" keeps the whole application fully usable without AI.
    ai_provider: Literal["none", "ollama", "institution", "hosted"] = "none"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [o.strip().rstrip("/") for o in value.split(",") if o.strip()]
        return value

    @field_validator("database_url", mode="before")
    @classmethod
    def _normalise_db_url(cls, value: object) -> object:
        """Accept the `postgresql://` URL Supabase shows and select the asyncpg driver."""
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return None
            for prefix in ("postgres://", "postgresql://"):
                if value.startswith(prefix):
                    return "postgresql+asyncpg://" + value[len(prefix) :]
        return value

    @model_validator(mode="after")
    def _validate_deployed(self) -> Settings:
        if self.environment in ("staging", "production"):
            problems: list[str] = []
            if self.database_url is None:
                problems.append("DATABASE_URL is required")
            if not self.database_ssl:
                problems.append("DATABASE_SSL must be true")
            if not self.cors_origins:
                problems.append("CORS_ORIGINS must list the frontend origin(s)")
            if any(o == "*" or not o.startswith("https://") for o in self.cors_origins):
                problems.append("CORS_ORIGINS must be explicit https:// origins (no '*')")
            if problems:
                raise ValueError("Invalid deployed configuration: " + "; ".join(problems))
        return self

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
