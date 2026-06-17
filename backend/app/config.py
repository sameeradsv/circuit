from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = ""
    cors_origins: str = "https://sameeradsv.github.io"
    # Populated from CORTEX_AUTH_URL env var (shared Cortex Auth Server), same as Canopy/Conduit.
    cortex_auth_url: str = Field(default="", validation_alias="CORTEX_AUTH_URL")
    groq_api_key: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
