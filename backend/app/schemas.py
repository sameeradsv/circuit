from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class TaskEventRead(BaseModel):
    id: int
    task_id: int
    event_type: str
    occurred_at: str
    metadata: dict[str, Any]
    task_text: Optional[str] = None
    undoable: bool = False


class UserStateRead(BaseModel):
    energy_level: float
    energy_manual_override: bool = False
    energy_manual_override_date: Optional[str] = None
    stress_level: float
    time_available_minutes: int
    focus_mode: str
    updated_at: str


class UserStateWrite(BaseModel):
    energy_level: float = Field(default=0.7, ge=0.0, le=1.0)
    energy_manual_override: bool = False
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


class SchedulingInsight(BaseModel):
    type: str = "prediction"
    message: str


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
    scheduling_insights: list[SchedulingInsight] = []


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


class AiTaskDefaultsResponse(BaseModel):
    tag: str
    urgency: float
    importance: float
    cognitive_load: float
    effort: str
    duration: int
    deadline_type: str
    time_sensitivity: float
    scheduled_at: Optional[int] = None
    recurrence: Optional[str] = None
    recurrence_ends_at: Optional[int] = None
    post_blackout_behavior: str
    emotional_resistance: float
    activation_energy: float
    recovery_cost: float
    focus_type: str
    consequence_of_delay: float
    momentum_value: float
    compound_benefit: float
    identity_alignment: float
    energy_to_reward_ratio: float
    task_decomposition_potential: float
    tiny_step: str
    preferred_execution_window: Optional[str] = None
    location_dependency: Optional[str] = None
    required_resources: list[str] = Field(default_factory=list)
    dependencies: list[str] = Field(default_factory=list)
    blackout_skip_flags: list[str] = Field(default_factory=list)
    travel_buffer_before_mins: Optional[int] = None
    travel_buffer_after_mins: Optional[int] = None
    notifications_enabled: bool = True
    notification_offset_1_mins: Optional[int] = 10
    notification_offset_2_mins: Optional[int] = None
    reasoning: str
