import { getAuthToken } from "./auth";

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
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(detail || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface ApiTask {
  id: number;
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
}

export type TaskIn = Partial<Omit<ApiTask, "id" | "created_at" | "updated_at">> & { text: string };
export type TaskPatch = Partial<Pick<ApiTask,
  | "text" | "completed" | "tag" | "tiny_step" | "effort" | "duration"
  | "deadline_type" | "time_sensitivity" | "scheduled_at" | "recurrence"
  | "urgency" | "importance" | "consequence_of_delay" | "momentum_value"
  | "compound_benefit" | "identity_alignment" | "energy_to_reward_ratio"
  | "task_decomposition_potential" | "historical_completion_rate"
  | "cognitive_load" | "emotional_resistance" | "activation_energy"
  | "recovery_cost" | "focus_type"
  | "skipped_count" | "last_skipped_at"
  | "preferred_execution_window" | "delay_pattern"
  | "required_resources" | "dependencies" | "metadata" | "location_dependency"
>>;

export interface ApiSettings {
  values: Record<string, unknown>;
}

export interface ApiUserState {
  energy_level: number;
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

export interface ApiSummary {
  total_tasks: number;
  completed_tasks: number;
  pending_tasks: number;
  completion_rate: number;
  total_pending_minutes: number;
  avg_skip_count: number;
  by_tag: Record<string, number>;
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

export const api = {
  // auth
  authStatus: () => req<{ has_users: boolean; sync_ready: boolean }>("GET", "/api/auth/status"),
  me: () => req<{ id: number; username: string }>("GET", "/api/auth/me"),
  register: (username: string, password: string) =>
    req<{ token: string; user: { id: number; username: string } }>("POST", "/api/auth/register", { username, password }),
  login: (username: string, password: string) =>
    req<{ token: string; user: { id: number; username: string } }>("POST", "/api/auth/login", { username, password }),

  // tasks
  listTasks: () => req<ApiTask[]>("GET", "/api/tasks"),
  createTask: (payload: TaskIn) => req<ApiTask>("POST", "/api/tasks", payload),
  updateTask: (id: number, patch: TaskPatch) => req<ApiTask>("PATCH", `/api/tasks/${id}`, patch),
  deleteTask: (id: number) => req<void>("DELETE", `/api/tasks/${id}`),
  cleanupOldTasks: (beforeMs: number) =>
    req<{ deleted: number }>("DELETE", `/api/tasks/cleanup?before_ms=${beforeMs}`),
  migrateTasks: (tasks: TaskIn[]) =>
    req<{ created: number; skipped: number }>("POST", "/api/tasks/migrate", tasks),

  // settings
  getSettings: () => req<ApiSettings>("GET", "/api/settings"),
  updateSettings: (values: Record<string, unknown>) =>
    req<ApiSettings>("PUT", "/api/settings", { values }),
  getSetting: (key: string) =>
    req<{ key: string; value: unknown }>("GET", `/api/settings/${key}`),
  setSetting: (key: string, value: unknown) =>
    req<{ key: string; value: unknown }>("PUT", `/api/settings/${key}`, { value }),

  // user state
  getSyncEnergy: () => req<{
    energy_so_far: number; drain_so_far: number;
    drain_ahead: number; energy_ahead: number;
    manual_energy: number; stress_level: number;
    events_so_far: number; events_ahead: number;
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
  getSummary: () => req<ApiSummary>("GET", "/api/summary"),

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

  // history events
  logEvent: (taskId: number, eventType: string, metadata: Record<string, unknown> = {}) =>
    req<ApiTaskEvent>("POST", "/api/history/events", { task_id: taskId, event_type: eventType, metadata }),
  getEvents: (taskId?: number) =>
    req<ApiTaskEvent[]>("GET", taskId ? `/api/history/events?task_id=${taskId}` : "/api/history/events"),
};
