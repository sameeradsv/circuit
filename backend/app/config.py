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
    cron_secret: str = Field(default="", validation_alias="CRON_SECRET")
    reminder_cron_secret: str = Field(default="", validation_alias="REMINDER_CRON_SECRET")
    reminder_materialize_days: int = Field(default=7, validation_alias="REMINDER_MATERIALIZE_DAYS")
    reminder_process_lookahead_seconds: int = Field(default=75, validation_alias="REMINDER_PROCESS_LOOKAHEAD_SECONDS")
    reminder_batch_size: int = Field(default=100, validation_alias="REMINDER_BATCH_SIZE")
    reminder_max_attempts: int = Field(default=3, validation_alias="REMINDER_MAX_ATTEMPTS")
    reminder_stale_after_hours: int = Field(default=6, validation_alias="REMINDER_STALE_AFTER_HOURS")
    icloud_apple_id: str = Field(default="", validation_alias="ICLOUD_APPLE_ID")
    icloud_app_specific_password: str = Field(default="", validation_alias="ICLOUD_APP_SPECIFIC_PASSWORD")
    icloud_caldav_base_url: str = Field(default="https://caldav.icloud.com", validation_alias="ICLOUD_CALDAV_BASE_URL")
    icloud_calendar_name: str = Field(default="Circuit", validation_alias="ICLOUD_CALENDAR_NAME")
    app_base_url: str = Field(default="", validation_alias="APP_BASE_URL")
    icloud_sync_enabled: bool = Field(default=False, validation_alias="ICLOUD_SYNC_ENABLED")
    icloud_sync_window_days: int = Field(default=7, validation_alias="ICLOUD_SYNC_WINDOW_DAYS")
    icloud_timezone: str = Field(default="Asia/Kolkata", validation_alias="ICLOUD_TIMEZONE")

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
