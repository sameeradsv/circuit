from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = ""
    cors_origins: str = "https://sameeradsv.github.io"
    init_db_on_startup: bool = Field(default=True, validation_alias="INIT_DB_ON_STARTUP")
    # Populated from CORTEX_AUTH_URL env var (shared Cortex Auth Server), same as Canopy/Conduit.
    cortex_auth_url: str = Field(default="", validation_alias="CORTEX_AUTH_URL")
    groq_api_key: str = ""
    vapid_public_key: str = Field(default="", validation_alias="VAPID_PUBLIC_KEY")
    vapid_private_key: str = Field(default="", validation_alias="VAPID_PRIVATE_KEY")
    vapid_subject: str = Field(default="mailto:admin@example.com", validation_alias="VAPID_SUBJECT")
    reminder_cron_secret: str = Field(default="", validation_alias="REMINDER_CRON_SECRET")
    reminder_materialize_days: int = Field(default=14, validation_alias="REMINDER_MATERIALIZE_DAYS")
    reminder_batch_size: int = Field(default=100, validation_alias="REMINDER_BATCH_SIZE")
    reminder_max_attempts: int = Field(default=3, validation_alias="REMINDER_MAX_ATTEMPTS")

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
