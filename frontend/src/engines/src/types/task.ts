export type Effort = 'low' | 'medium' | 'high';
export type TaskTag = 'general' | 'work' | 'social' | 'later';
export type DeadlineType = 'none' | 'soft' | 'hard';
export type FocusType = 'deep' | 'shallow' | 'admin' | 'creative';
export type EnergyMode = 'normal' | 'deep' | 'low' | 'social';

export interface Task {
  id: string;
  text: string;
  completed: boolean;
  tag: TaskTag;
  tinyStep: string;
  effort: Effort;
  createdAt: number;
  updatedAt: number;

  duration: number;
  deadlineType: DeadlineType;
  timeSensitivity: number;
  recurrence: string | null;
  scheduledAt: number | null;

  cognitiveLoad: number;
  emotionalResistance: number;
  activationEnergy: number;
  recoveryCost: number;
  focusType: FocusType;

  locationDependency: string | null;
  requiredResources: string[];
  dependencies: string[];

  importance: number;
  urgency: number;
  consequenceOfDelay: number;
  momentumValue: number;
  compoundBenefit: number;
  identityAlignment: number;

  historicalCompletionRate: number;
  preferredExecutionWindow: string | null;
  delayPattern: string | null;
  taskDecompositionPotential: number;
  energyToRewardRatio: number;

  metadata: Record<string, unknown>;
  skippedCount: number;
  lastSkippedAt: number | null;
}

export interface LegacyTask {
  id?: number | string;
  text?: string;
  completed?: boolean;
  tag?: string;
  tinyStep?: string;
  effort?: string;
  createdAt?: number;
}

export interface ScheduleContext {
  mode: EnergyMode;
  now: number;
  availableMinutes: number;
  completedToday: number;
}

export interface ScoredTask {
  task: Task;
  score: number;
  reasons: string[];
}

export interface SchedulePlan {
  ordered: ScoredTask[];
  explanation: string;
  workloadMinutes: number;
}

export interface RescheduleResult {
  tasks: Task[];
  changes: string[];
}

export interface BehavioralInsight {
  type: 'window' | 'procrastination' | 'completion' | 'recommendation';
  message: string;
  taskId?: string;
}
