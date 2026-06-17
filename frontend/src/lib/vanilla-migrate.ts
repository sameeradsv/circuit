import type { TaskIn } from "./api";

const STORAGE_PREFIX = "circuit_tasks_v1";
const LEGACY_KEY = "my_tasks_v2";

interface VanillaTask {
  id?: string | number;
  text?: string;
  completed?: boolean;
  tag?: string;
  tinyStep?: string;
  effort?: string;
  createdAt?: number;
  updatedAt?: number;
  duration?: number;
  deadlineType?: string;
  timeSensitivity?: number;
  scheduledAt?: number | null;
  recurrence?: string | null;
  cognitiveLoad?: number;
  emotionalResistance?: number;
  activationEnergy?: number;
  recoveryCost?: number;
  focusType?: string;
  locationDependency?: string | null;
  requiredResources?: string[];
  dependencies?: string[];
  importance?: number;
  urgency?: number;
  consequenceOfDelay?: number;
  momentumValue?: number;
  compoundBenefit?: number;
  identityAlignment?: number;
  historicalCompletionRate?: number;
  preferredExecutionWindow?: string | null;
  delayPattern?: string | null;
  taskDecompositionPotential?: number;
  energyToRewardRatio?: number;
  metadata?: Record<string, unknown>;
  skippedCount?: number;
  lastSkippedAt?: number | null;
}

function toTaskIn(v: VanillaTask): TaskIn | null {
  const text = (v.text ?? "").trim();
  if (!text) return null;
  return {
    text,
    client_id: v.id != null ? String(v.id) : undefined,
    completed: Boolean(v.completed),
    tag: v.tag ?? "general",
    tiny_step: v.tinyStep ?? "",
    effort: v.effort ?? "medium",
    client_created_at: v.createdAt ?? null,
    client_updated_at: v.updatedAt ?? null,
    duration: v.duration ?? 30,
    deadline_type: v.deadlineType ?? "none",
    time_sensitivity: v.timeSensitivity ?? 0.5,
    scheduled_at: v.scheduledAt ?? null,
    recurrence: v.recurrence ?? null,
    cognitive_load: v.cognitiveLoad ?? 0.5,
    emotional_resistance: v.emotionalResistance ?? 0.5,
    activation_energy: v.activationEnergy ?? 0.5,
    recovery_cost: v.recoveryCost ?? 0.3,
    focus_type: v.focusType ?? "shallow",
    location_dependency: v.locationDependency ?? null,
    required_resources: v.requiredResources ?? [],
    dependencies: v.dependencies ?? [],
    importance: v.importance ?? 0.5,
    urgency: v.urgency ?? 0.5,
    consequence_of_delay: v.consequenceOfDelay ?? 0.3,
    momentum_value: v.momentumValue ?? 0.5,
    compound_benefit: v.compoundBenefit ?? 0.3,
    identity_alignment: v.identityAlignment ?? 0.3,
    historical_completion_rate: v.historicalCompletionRate ?? 0.7,
    preferred_execution_window: v.preferredExecutionWindow ?? null,
    delay_pattern: v.delayPattern ?? null,
    task_decomposition_potential: v.taskDecompositionPotential ?? 0.3,
    energy_to_reward_ratio: v.energyToRewardRatio ?? 0.5,
    metadata: v.metadata ?? {},
    skipped_count: v.skippedCount ?? 0,
    last_skipped_at: v.lastSkippedAt ?? null,
  };
}

function parseStorageKey(key: string): VanillaTask[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as VanillaTask[];
  } catch {
    return [];
  }
}

/** Scan localStorage for vanilla PWA task dumps. */
export function discoverVanillaTaskStores(): { key: string; count: number }[] {
  if (typeof window === "undefined") return [];
  const keys = new Set<string>();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key === LEGACY_KEY || key.startsWith(STORAGE_PREFIX)) keys.add(key);
  }
  return [...keys].map((key) => ({
    key,
    count: parseStorageKey(key).filter((t) => (t.text ?? "").trim()).length,
  })).filter((e) => e.count > 0);
}

export function vanillaTasksFromKey(key: string): TaskIn[] {
  return parseStorageKey(key)
    .map(toTaskIn)
    .filter((t): t is TaskIn => t !== null);
}
