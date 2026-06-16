from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class TaskEventRead(BaseModel):
    id: int
    task_id: int
    event_type: str
    occurred_at: str
    metadata: dict[str, Any]


class UserStateRead(BaseModel):
    energy_level: float
    stress_level: float
    time_available_minutes: int
    focus_mode: str
    updated_at: str


class UserStateWrite(BaseModel):
    energy_level: float = Field(default=0.7, ge=0.0, le=1.0)
    stress_level: float = Field(default=0.3, ge=0.0, le=1.0)
    time_available_minutes: int = Field(default=480, ge=0, le=1440)
    focus_mode: str = "normal"


class SettingsRead(BaseModel):
    values: dict[str, Any]


class SettingsWrite(BaseModel):
    values: dict[str, Any]


class ExportRequest(BaseModel):
    passphrase: str = Field(min_length=8, max_length=200)


class ImportRequest(BaseModel):
    passphrase: str = Field(min_length=8, max_length=200)
    blob: dict


class TaskSearchItem(BaseModel):
    id: int
    text: str
    tag: str
    completed: bool
    urgency: float
    importance: float
    effort: str
    scheduled_at: Optional[int]


class SearchResult(BaseModel):
    query: str
    tasks: list[TaskSearchItem]
    total: int


class AnalyticsTaskBrief(BaseModel):
    id: int
    text: str
    skipped_count: int = 0
    days_open: int = 0


class AttentionItem(BaseModel):
    message: str
    task_id: int


class SummaryResponse(BaseModel):
    total_tasks: int
    completed_tasks: int
    pending_tasks: int
    completion_rate: float
    total_pending_minutes: int
    avg_skip_count: float
    by_tag: dict[str, int]
    most_skipped: list[AnalyticsTaskBrief] = []
    stale_tasks: list[AnalyticsTaskBrief] = []
    attention_needed: list[AttentionItem] = []


class AiClassifyRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    context: Optional[str] = None


class AiClassifyResponse(BaseModel):
    urgency: float
    importance: float
    cognitive_load: float
    effort: str
    tag: str
    reasoning: str
