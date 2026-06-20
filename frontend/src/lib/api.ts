import { getAuthToken, setAuthToken } from "./auth";

const apiBase =
  (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    setAuthToken(null);
    if (typeof window !== "undefined") window.location.replace("/login");
    throw new Error("Session expired");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(detail || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface ApiTask {
  id: number | string;
  client_id: string | null;
  text: string;
  tag: string;
  completed: boolean;
  tiny_step: string;
  effort: string;
  duration: number;
  deadline_type: string;
  time_sensitivity: number;
  scheduled_at: number | null;
  recurrence: string | null;
  cognitive_load: number;
  emotional_resistance: number;
  activation_energy: number;
  recovery_cost: number;
  focus_type: string;
  importance: number;
  urgency: number;
  consequence_of_delay: number;
  momentum_value: number;
  compound_benefit: number;
  identity_alignment: number;
  historical_completion_rate: number;
  skipped_count: number;
  last_skipped_at: number | null;
  energy_to_reward_ratio: number;
  task_decomposition_potential: number;
  required_resources: string[];
  dependencies: string[];
  metadata: Record<string, unknown>;
  preferred_execution_window: string | null;
  delay_pattern: string | null;
  location_dependency: string | null;
  client_created_at: number | null;
  client_updated_at: number | null;
  created_at: string;
  updated_at: string;
  blackout_skip_flags: string[];
  rrule: string | null;
  rrule_dtstart_ms: number | null;
  is_recurring_template: boolean;
  recurrence_ends_at: number | null;
  post_blackout_behavior: "resume" | "catch_up" | "catch_up_once" | "catch_up_immediate" | "catch_up_imm_shift";
  group_id: string | null;
  day_time_overrides: Record<string, string>;  // {"SA": "10:00", "SU": "10:00"}
  travel_buffer_before_mins: number | null;
  travel_buffer_after_mins: number | null;
  notifications_enabled: boolean;
  notification_offset_1_mins: number | null;
  notification_offset_2_mins: number | null;
  recurrence_anchor_ms: number | null;
  import_review_pending: boolean;
  is_virtual_occurrence?: boolean;
  recurring_task_id?: number | null;
  occurrence_start_ms?: number | null;
  source_task_id?: number | null;
  occurrence_override_status?: "completed" | "skipped" | "rescheduled";
}

export type TaskIn = Partial<Omit<ApiTask, "id" | "created_at" | "updated_at">> & { text: string };
export type TaskPatch = Partial<Pick<ApiTask,
  | "text" | "completed" | "tag" | "tiny_step" | "effort" | "duration"
  | "deadline_type" | "time_sensitivity" | "scheduled_at" | "recurrence"
  | "recurrence_ends_at" | "post_blackout_behavior"
  | "urgency" | "importance" | "consequence_of_delay" | "momentum_value"
  | "compound_benefit" | "identity_alignment" | "energy_to_reward_ratio"
  | "task_decomposition_potential" | "historical_completion_rate"
  | "cognitive_load" | "emotional_resistance" | "activation_energy"
  | "recovery_cost" | "focus_type"
  | "skipped_count" | "last_skipped_at"
  | "preferred_execution_window" | "delay_pattern"
  | "required_resources" | "dependencies" | "metadata" | "location_dependency"
  | "blackout_skip_flags"
  | "group_id" | "day_time_overrides"
  | "travel_buffer_before_mins" | "travel_buffer_after_mins"
  | "notifications_enabled" | "notification_offset_1_mins" | "notification_offset_2_mins"
  | "recurrence_anchor_ms" | "import_review_pending"
>> & { propagate_group?: boolean; completion_occurred_at?: number };

export interface ApiSleepLog {
  id: number | null;
  date: string;
  bedtime_ms: number | null;
  wake_ms: number | null;
  quality: number | null;       // 0–10
  quality_is_default?: boolean;
  disturbed: boolean | null;
  notes: string | null;
  duration_h: number | null;
  source?: "task" | "manual" | "mixed" | "default";
  created_at: string | null;
  updated_at: string | null;
}

export interface ApiSleepOverridePage {
  items: ApiSleepLog[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface ApiSleepFactor {
  date: string;
  sleep_factor: number;         // 0–1
  notes: string[];
  has_sleep_log: boolean;
  sleep_log: ApiSleepLog | null;
  default_sleep_quality?: number;
  default_bedtime?: string | null;
  default_wake_time?: string | null;
  work_signals: {
    work_end_hour_yesterday: number | null;
    work_span_hours_yesterday: number | null;
    first_event_hour_today: number | null;
  };
}

export interface ApiBlackout {
  id: number;
  blackout_type: string;
  start_date_ms: number;
  end_date_ms: number;
  created_at: string;
  tasks_rescheduled?: number;
}

export interface ApiSettings {
  values: Record<string, unknown>;
}

export interface ApiUserState {
  energy_level: number;
  energy_manual_override?: boolean;
  energy_manual_override_date?: string | null;
  stress_level: number;
  time_available_minutes: number;
  focus_mode: string;
  updated_at: string;
}

export interface ApiSearchResult {
  query: string;
  tasks: Array<{
    id: number;
    text: string;
    tag: string;
    completed: boolean;
    urgency: number;
    importance: number;
    effort: string;
    scheduled_at: number | null;
  }>;
  total: number;
}

export interface EnergyTimelineEvent {
  occurred_at: string;
  time: string;
  energy: number;
  delta?: number;
  running_energy?: number;
  label: "draining" | "neutral" | "energising";
  note: string;
  source: string;
}

export interface EnergyTimeline {
  date: string;
  source: string;
  start_energy: number;
  end_energy: number;
  events: EnergyTimelineEvent[];
  avg_energy: number | null;
}

export interface ApiSummary {
  total_tasks: number;
  completed_tasks: number;
  pending_tasks: number;
  completion_rate: number;
  total_pending_minutes: number;
  avg_skip_count: number;
  by_tag: Record<string, number>;
  most_skipped: { id: number; text: string; skipped_count: number; days_open?: number }[];
  stale_tasks: { id: number; text: string; skipped_count?: number; days_open: number }[];
  attention_needed: { message: string; task_id: number }[];
  scheduling_insights?: { type: string; message: string }[];
}

export interface ApiAiClassify {
  urgency: number;
  importance: number;
  cognitive_load: number;
  effort: string;
  tag: string;
  reasoning: string;
}

export interface ApiTaskEvent {
  id: number;
  task_id: number;
  event_type: string;
  occurred_at: string;
  metadata: Record<string, unknown>;
}

export interface ApiTaskPage {
  items: ApiTask[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export type ListTasksOpts = {
  completed?: boolean;
  scheduled_from_ms?: number;
  scheduled_to_ms?: number;
  include_unscheduled?: boolean;
};

export type ListTasksPageOpts = {
  completed?: boolean;
  page?: number;
  limit?: number;
};

export const api = {
  // auth
  authStatus: () => req<{ has_users: boolean }>("GET", "/api/auth/status"),
  register: (username: string, password: string) =>
    req<{ token: string; user: { id: number; username: string } }>("POST", "/api/auth/register", { username, password }),
  login: (username: string, password: string) =>
    req<{ token: string; user: { id: number; username: string } }>("POST", "/api/auth/login", { username, password }),

  // tasks
  listTasks: (opts?: ListTasksOpts) => {
    const params = new URLSearchParams();
    if (opts?.completed !== undefined) params.set("completed", String(opts.completed));
    if (opts?.scheduled_from_ms != null) params.set("scheduled_from_ms", String(opts.scheduled_from_ms));
    if (opts?.scheduled_to_ms != null) params.set("scheduled_to_ms", String(opts.scheduled_to_ms));
    if (opts?.include_unscheduled) params.set("include_unscheduled", "true");
    const q = params.toString();
    return req<ApiTask[]>("GET", q ? `/api/tasks?${q}` : "/api/tasks");
  },
  listTasksPage: (opts: ListTasksPageOpts = {}) => {
    const params = new URLSearchParams();
    if (opts.completed !== undefined) params.set("completed", String(opts.completed));
    params.set("page", String(opts.page ?? 1));
    params.set("limit", String(opts.limit ?? 20));
    return req<ApiTaskPage>("GET", `/api/tasks?${params}`);
  },
  createTask: (payload: TaskIn) => req<ApiTask>("POST", "/api/tasks", payload),
  migrateTasks: (payload: TaskIn[]) =>
    req<{ created: number; skipped: number }>("POST", "/api/tasks/migrate", payload),
  updateTask: (id: ApiTask["id"], patch: TaskPatch) => req<ApiTask>("PATCH", `/api/tasks/${id}`, patch),
  batchUpdate: (ids: number[], patch: TaskPatch) =>
    req<{ updated: number; ids: number[] }>("POST", "/api/tasks/batch-update", { ids, patch }),
  deleteTask: (id: number) => req<void>("DELETE", `/api/tasks/${id}`),
  cleanupTasks: (opts: { afterMs?: number; beforeMs?: number }) => {
    const params = new URLSearchParams();
    if (opts.afterMs  != null) params.set("after_ms",  String(opts.afterMs));
    if (opts.beforeMs != null) params.set("before_ms", String(opts.beforeMs));
    const token = getAuthToken();
    return fetch(`${apiBase}/api/tasks/cleanup?${params}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
      return res.json() as Promise<{ deleted: number }>;
    });
  },
  // settings
  getSettings: () => req<ApiSettings>("GET", "/api/settings"),
  updateSettings: (values: Record<string, unknown>) =>
    req<ApiSettings>("PUT", "/api/settings", { values }),
  // user state
  getSyncEnergy: () => req<{
    energy_so_far: number; drain_so_far: number;
    drain_ahead: number; energy_ahead: number;
    manual_energy: number; stress_level: number;
    events_so_far: number; events_ahead: number;
    running_energy: number; start_energy: number;
    sleep_factor: number; sleep_notes: string[];
  }>("GET", "/api/energy/sync"),
  getUserState: () => req<ApiUserState>("GET", "/api/user/state"),
  setUserState: (state: Partial<Omit<ApiUserState, "updated_at">>) =>
    req<ApiUserState>("POST", "/api/user/state", state),
  deleteUserData: () => req<void>("DELETE", "/api/user/data"),

  // sync / export-import
  exportData: (passphrase: string) =>
    req<Record<string, unknown>>("POST", "/api/sync/export", { passphrase }),
  importData: (passphrase: string, blob: Record<string, unknown>) =>
    req<{ status: string; tasks_created: number; tasks_skipped: number }>(
      "POST", "/api/sync/import", { passphrase, blob }
    ),

  // search & summary
  search: (q: string) => req<ApiSearchResult>("GET", `/api/search?q=${encodeURIComponent(q)}`),
  getSummary: (date?: string) =>
    req<ApiSummary>("GET", `/api/summary${date ? `?date=${encodeURIComponent(date)}` : ""}`),

  getEnergyTimeline: (date?: string) =>
    req<EnergyTimeline>("GET", `/api/energy/timeline${date ? `?date=${date}` : ""}`),

  // AI classify
  classifyTask: (text: string, context?: string) =>
    req<ApiAiClassify>("POST", "/api/ai/classify", { text, context }),

  // calendar
  deleteSeries: (taskId: number, fromScheduledAt?: number) =>
    req<{ deleted: number }>("DELETE", `/api/calendar/series/${taskId}${fromScheduledAt != null ? `?from_scheduled_at=${fromScheduledAt}` : ''}`),
  propagateClassification: (
    taskId: number,
    opts: { include_classification?: boolean; include_text?: boolean; from_scheduled_at?: number } = {},
  ) => req<{ updated: number }>("POST", `/api/calendar/propagate-classification/${taskId}`, {
    include_classification: opts.include_classification ?? true,
    include_text: opts.include_text ?? false,
    from_scheduled_at: opts.from_scheduled_at ?? null,
  }),
  getCalendarExpiry: () =>
    req<{ expires_at_ms: number | null; expires_at_iso: string | null; days_until_expiry: number | null }>("GET", "/api/calendar/expiry"),
  exportCalendar: (includeCompleted = false) => {
    const token = getAuthToken();
    const url = `${apiBase}/api/calendar/export${includeCompleted ? "?include_completed=true" : ""}`;
    return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  },
  importCalendar: (file: File) => {
    const token = getAuthToken();
    const form = new FormData();
    form.append("file", file);
    return fetch(`${apiBase}/api/calendar/import`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    }).then(async (res) => {
      if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
      return res.json() as Promise<{ imported: number; total: number; expires_at: number | null }>;
    });
  },

  // sleep
  logSleep: (payload: {
    date?: string;
    quality?: number | null;
    disturbed?: boolean;
    notes?: string | null;
  }) => req<ApiSleepLog>("POST", "/api/sleep", payload),
  listSleepOverrides: (page = 1, limit = 10) =>
    req<ApiSleepOverridePage>("GET", `/api/sleep/overrides?page=${page}&limit=${limit}`),
  deleteSleepOverride: (date: string) => req<void>("DELETE", `/api/sleep/${date}`),
  getSleepFactor: () => req<ApiSleepFactor>("GET", "/api/sleep/factor"),

  // blackouts
  listBlackouts: () => req<ApiBlackout[]>("GET", "/api/blackouts"),
  createBlackout: (payload: { blackout_type: string; start_date_ms: number; end_date_ms: number }) =>
    req<ApiBlackout>("POST", "/api/blackouts", payload),
  updateBlackout: (id: number, payload: { blackout_type: string; start_date_ms: number; end_date_ms: number }) =>
    req<ApiBlackout>("PATCH", `/api/blackouts/${id}`, payload),
  deleteBlackout: (id: number) => req<void>("DELETE", `/api/blackouts/${id}`),

  // history events
  logEvent: (taskId: number, eventType: string, metadata: Record<string, unknown> = {}) =>
    req<ApiTaskEvent>("POST", "/api/history/events", { task_id: taskId, event_type: eventType, metadata }),
};
