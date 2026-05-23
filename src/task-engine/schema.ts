import type { Effort, FocusType, LegacyTask, Task, TaskTag } from '../types';

const EFFORT_LOAD: Record<Effort, number> = {
  low: 0.25,
  medium: 0.5,
  high: 0.8,
};

const TAG_FOCUS: Record<TaskTag, FocusType> = {
  general: 'shallow',
  work: 'deep',
  social: 'shallow',
  later: 'admin',
};

export function createTaskId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function inferTagFromText(text: string): TaskTag {
  const lower = text.toLowerCase();
  if (/\b(meeting|email|report|review|code|develop|deploy|fix|bug|test|call|presentation)\b/.test(lower)) {
    return 'work';
  }
  if (/\b(friend|family|birthday|party|dinner|lunch|visit|message)\b/.test(lower)) {
    return 'social';
  }
  if (/\b(someday|maybe|later|eventually|consider|explore|research)\b/.test(lower)) {
    return 'later';
  }
  return 'general';
}

export function inferEffortFromText(text: string): Effort {
  const lower = text.toLowerCase();
  if (/\b(quick|simple|easy|small|5\s*min)\b/.test(lower)) return 'low';
  if (/\b(complex|difficult|major|large|project|big)\b/.test(lower)) return 'high';
  return 'medium';
}

export function createTask(text: string, overrides: Partial<Task> = {}): Task {
  const now = Date.now();
  const tag = overrides.tag ?? inferTagFromText(text);
  const effort = overrides.effort ?? inferEffortFromText(text);
  const load = EFFORT_LOAD[effort];

  return {
    id: createTaskId(),
    text: text.trim(),
    completed: false,
    tag,
    tinyStep: '',
    effort,
    createdAt: now,
    updatedAt: now,
    duration: effort === 'low' ? 15 : effort === 'high' ? 60 : 30,
    deadlineType: 'none',
    timeSensitivity: tag === 'work' ? 0.6 : 0.3,
    recurrence: null,
    scheduledAt: null,
    cognitiveLoad: load,
    emotionalResistance: effort === 'high' ? 0.6 : 0.3,
    activationEnergy: load,
    recoveryCost: load * 0.5,
    focusType: TAG_FOCUS[tag],
    locationDependency: null,
    requiredResources: [],
    dependencies: [],
    importance: tag === 'work' ? 0.7 : 0.4,
    urgency: 0.4,
    consequenceOfDelay: tag === 'work' ? 0.5 : 0.2,
    momentumValue: 0.3,
    compoundBenefit: tag === 'work' ? 0.5 : 0.2,
    identityAlignment: 0.4,
    historicalCompletionRate: 0.5,
    preferredExecutionWindow: null,
    delayPattern: null,
    taskDecompositionPotential: effort === 'high' ? 0.8 : 0.3,
    energyToRewardRatio: effort === 'low' ? 0.8 : 0.4,
    metadata: {},
    skippedCount: 0,
    lastSkippedAt: null,
    rescheduleLog: [],
    ...overrides,
  };
}

export function normalizeTask(raw: LegacyTask | Task): Task {
  if ('cognitiveLoad' in raw && typeof raw.cognitiveLoad === 'number') {
    return { ...createTask(raw.text ?? ''), ...raw, updatedAt: raw.updatedAt ?? Date.now() };
  }

  const text = raw.text ?? '';
  const effort = (['low', 'medium', 'high'].includes(raw.effort ?? '')
    ? raw.effort
    : inferEffortFromText(text)) as Effort;
  const tag = (['general', 'work', 'social', 'later'].includes(raw.tag ?? '')
    ? raw.tag
    : inferTagFromText(text)) as TaskTag;

  return createTask(text, {
    id: String(raw.id ?? createTaskId()),
    completed: Boolean(raw.completed),
    tag,
    effort,
    tinyStep: raw.tinyStep ?? '',
    createdAt: raw.createdAt ?? Date.now(),
  });
}

export function effortToDuration(effort: Effort): number {
  return effort === 'low' ? 15 : effort === 'high' ? 60 : 30;
}
