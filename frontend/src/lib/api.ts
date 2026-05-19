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
export type TaskPatch = Partial<Pick<ApiTask, "text" | "completed" | "tag" | "tiny_step" | "effort" | "duration" | "deadline_type" | "time_sensitivity" | "scheduled_at" | "urgency" | "importance" | "skipped_count" | "last_skipped_at">>;

export const api = {
  // auth
  authStatus: () => req<{ has_users: boolean; sync_ready: boolean }>("GET", "/api/auth/status"),
  register: (username: string, password: string) =>
    req<{ token: string; user: { id: number; username: string } }>("POST", "/api/auth/register", { username, password }),
  login: (username: string, password: string) =>
    req<{ token: string; user: { id: number; username: string } }>("POST", "/api/auth/login", { username, password }),

  // tasks
  listTasks: () => req<ApiTask[]>("GET", "/api/tasks"),
  createTask: (payload: TaskIn) => req<ApiTask>("POST", "/api/tasks", payload),
  updateTask: (id: number, patch: TaskPatch) => req<ApiTask>("PATCH", `/api/tasks/${id}`, patch),
  deleteTask: (id: number) => req<void>("DELETE", `/api/tasks/${id}`),
  migrateTasks: (tasks: TaskIn[]) =>
    req<{ created: number; skipped: number }>("POST", "/api/tasks/migrate", tasks),
};
