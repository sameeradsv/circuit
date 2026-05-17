import type { DeadlineType, Effort, FocusType, Task, TaskTag } from '../types';

export type FormPrefix = 'add' | 'detail';

export interface DimensionSection {
  title: string;
  fields: DimensionField[];
}

type ScalarTaskKey = {
  [K in keyof Task]: Task[K] extends string | number | null ? K : never;
}[keyof Task];

export type DimensionField =
  | {
      key: ScalarTaskKey;
      label: string;
      kind: 'number';
      min: number;
      max: number;
      step?: number;
    }
  | { key: ScalarTaskKey; label: string; kind: 'range01' }
  | {
      key: ScalarTaskKey;
      label: string;
      kind: 'select';
      options: { value: string; label: string }[];
    }
  | { key: ScalarTaskKey; label: string; kind: 'text'; placeholder?: string }
  | { key: 'requiredResources' | 'dependencies'; label: string; kind: 'list'; placeholder?: string }
  | { key: 'scheduledAt'; label: string; kind: 'datetime' };

export const DIMENSION_SECTIONS: DimensionSection[] = [
  {
    title: 'Basics',
    fields: [
      {
        key: 'tinyStep',
        label: 'Tiny step',
        kind: 'text',
        placeholder: 'Open the file and do one edit',
      },
    ],
  },
  {
    title: 'Time',
    fields: [
      { key: 'duration', label: 'Duration (min)', kind: 'number', min: 5, max: 480, step: 5 },
      {
        key: 'deadlineType',
        label: 'Deadline',
        kind: 'select',
        options: [
          { value: 'none', label: 'None' },
          { value: 'soft', label: 'Soft' },
          { value: 'hard', label: 'Hard' },
        ],
      },
      { key: 'timeSensitivity', label: 'Time sensitivity', kind: 'range01' },
      { key: 'scheduledAt', label: 'Scheduled', kind: 'datetime' },
      {
        key: 'recurrence',
        label: 'Recurrence',
        kind: 'select',
        options: [
          { value: '', label: 'None' },
          { value: 'daily', label: 'Daily' },
          { value: 'weekly', label: 'Weekly' },
          { value: 'monthly', label: 'Monthly' },
          { value: 'weekdays', label: 'Weekdays' },
        ],
      },
    ],
  },
  {
    title: 'Cognitive / energy',
    fields: [
      {
        key: 'effort',
        label: 'Effort',
        kind: 'select',
        options: [
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
        ],
      },
      {
        key: 'focusType',
        label: 'Focus',
        kind: 'select',
        options: [
          { value: 'deep', label: 'Deep' },
          { value: 'shallow', label: 'Shallow' },
          { value: 'admin', label: 'Admin' },
          { value: 'creative', label: 'Creative' },
        ],
      },
      { key: 'cognitiveLoad', label: 'Cognitive load', kind: 'range01' },
      { key: 'emotionalResistance', label: 'Emotional resistance', kind: 'range01' },
      { key: 'activationEnergy', label: 'Activation energy', kind: 'range01' },
      { key: 'recoveryCost', label: 'Recovery cost', kind: 'range01' },
    ],
  },
  {
    title: 'Context',
    fields: [
      {
        key: 'locationDependency',
        label: 'Location',
        kind: 'text',
        placeholder: 'home, office, out',
      },
      {
        key: 'requiredResources',
        label: 'Resources',
        kind: 'list',
        placeholder: 'laptop, keys (comma-separated)',
      },
      {
        key: 'dependencies',
        label: 'Dependencies',
        kind: 'list',
        placeholder: 'other task ids (comma-separated)',
      },
    ],
  },
  {
    title: 'Priority / value',
    fields: [
      { key: 'importance', label: 'Importance', kind: 'range01' },
      { key: 'urgency', label: 'Urgency', kind: 'range01' },
      { key: 'consequenceOfDelay', label: 'Consequence of delay', kind: 'range01' },
      { key: 'momentumValue', label: 'Momentum', kind: 'range01' },
      { key: 'compoundBenefit', label: 'Compound benefit', kind: 'range01' },
      { key: 'identityAlignment', label: 'Identity alignment', kind: 'range01' },
    ],
  },
  {
    title: 'Behavioral',
    fields: [
      { key: 'historicalCompletionRate', label: 'Completion rate', kind: 'range01' },
      {
        key: 'preferredExecutionWindow',
        label: 'Best window',
        kind: 'text',
        placeholder: 'morning, afternoon, evening',
      },
      {
        key: 'delayPattern',
        label: 'Delay pattern',
        kind: 'text',
        placeholder: 'weekends, after 8pm',
      },
      { key: 'taskDecompositionPotential', label: 'Split potential', kind: 'range01' },
      { key: 'energyToRewardRatio', label: 'Energy / reward', kind: 'range01' },
    ],
  },
];

export function fieldId(prefix: FormPrefix, key: string): string {
  return `${prefix}-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
}

export function renderDimensionSections(prefix: FormPrefix, task: Task): string {
  return DIMENSION_SECTIONS.map((section) => {
    const fields = section.fields
      .map((field) => {
        const id = fieldId(prefix, field.key);
        const value = task[field.key as keyof Task];
        let control = '';
        if (field.kind === 'number') {
          control = `<input id="${id}" type="number" min="${field.min}" max="${field.max}" step="${field.step ?? 1}" value="${value ?? ''}" />`;
        } else if (field.kind === 'range01') {
          const pct = Math.round((Number(value) || 0) * 100);
          control = `<input id="${id}" type="range" min="0" max="100" step="5" value="${pct}" data-scale="0.01" /><span class="range-value" data-for="${id}">${pct}%</span>`;
        } else if (field.kind === 'select') {
          control = `<select id="${id}">${field.options
            .map(
              (opt) =>
                `<option value="${escapeAttr(opt.value)}"${String(value ?? '') === opt.value ? ' selected' : ''}>${opt.label}</option>`,
            )
            .join('')}</select>`;
        } else if (field.kind === 'text') {
          control = `<input id="${id}" type="text" placeholder="${escapeAttr(field.placeholder ?? '')}" value="${escapeAttr(String(value ?? ''))}" />`;
        } else if (field.kind === 'list') {
          const list = Array.isArray(value) ? value.join(', ') : '';
          control = `<input id="${id}" type="text" placeholder="${escapeAttr(field.placeholder ?? '')}" value="${escapeAttr(list)}" />`;
        } else if (field.kind === 'datetime') {
          const ts = typeof value === 'number' ? value : null;
          control = `<input id="${id}" type="datetime-local" value="${ts ? toLocalInputValue(ts) : ''}" />`;
        }
        return `<label class="detail-row dimension-row"><span>${field.label}</span><span class="dimension-control">${control}</span></label>`;
      })
      .join('');
    return `<div class="dimension-section"><h3 class="dimension-section-title">${section.title}</h3>${fields}</div>`;
  }).join('');
}

export function bindRangeLabels(root: ParentNode): void {
  root.querySelectorAll<HTMLInputElement>('input[type="range"][data-scale]').forEach((input) => {
    const label = root.querySelector(`[data-for="${input.id}"]`);
    const sync = () => {
      if (label) label.textContent = `${input.value}%`;
    };
    input.addEventListener('input', sync);
    sync();
  });
}

export function applyOverridesToForm(prefix: FormPrefix, overrides: Partial<Task>): void {
  for (const section of DIMENSION_SECTIONS) {
    for (const field of section.fields) {
      if (!(field.key in overrides)) continue;
      const el = document.getElementById(fieldId(prefix, field.key));
      if (!el) continue;
      const value = overrides[field.key as keyof Task];
      if (field.kind === 'range01') {
        (el as HTMLInputElement).value = String(Math.round((Number(value) || 0) * 100));
      } else if (field.kind === 'list') {
        (el as HTMLInputElement).value = Array.isArray(value) ? value.join(', ') : '';
      } else if (field.kind === 'datetime') {
        (el as HTMLInputElement).value =
          typeof value === 'number' ? toLocalInputValue(value) : '';
      } else {
        (el as HTMLInputElement).value = String(value ?? '');
      }
    }
  }
  bindRangeLabels(document.getElementById('add-dimensions-root') ?? document);
}

export function readDimensionOverrides(prefix: FormPrefix, base: Task): Partial<Task> {
  const overrides: Partial<Task> = {};

  for (const section of DIMENSION_SECTIONS) {
    for (const field of section.fields) {
      const el = document.getElementById(fieldId(prefix, field.key)) as HTMLInputElement | HTMLSelectElement | null;
      if (!el) continue;

      if (field.kind === 'number') {
        const n = Number(el.value);
        (overrides as Record<string, unknown>)[field.key] = Number.isFinite(n) ? n : base[field.key as keyof Task];
      } else if (field.kind === 'range01') {
        (overrides as Record<string, unknown>)[field.key] = clamp01(Number(el.value) / 100);
      } else if (field.kind === 'select') {
        const raw = el.value;
        if (field.key === 'recurrence') {
          (overrides as Record<string, unknown>)[field.key] = raw || null;
        } else {
          (overrides as Record<string, unknown>)[field.key] = raw;
        }
      } else if (field.kind === 'text') {
        const raw = el.value.trim();
        (overrides as Record<string, unknown>)[field.key] = raw || null;
      } else if (field.kind === 'list') {
        (overrides as Record<string, unknown>)[field.key] = parseList(el.value);
      } else if (field.kind === 'datetime') {
        (overrides as Record<string, unknown>)[field.key] = el.value
          ? new Date(el.value).getTime()
          : null;
      }
    }
  }

  const effort = (overrides.effort ?? base.effort) as Effort;
  if (overrides.effort && !('duration' in overrides)) {
    overrides.duration = effort === 'low' ? 15 : effort === 'high' ? 60 : 30;
  }

  return overrides;
}

export function mergeTaskDimensions(base: Task, overrides: Partial<Task>): Task {
  const merged = { ...base, ...overrides, updatedAt: Date.now() };
  merged.duration = clamp(merged.duration, 5, 480);
  for (const key of [
    'cognitiveLoad',
    'emotionalResistance',
    'activationEnergy',
    'recoveryCost',
    'importance',
    'urgency',
    'consequenceOfDelay',
    'momentumValue',
    'compoundBenefit',
    'identityAlignment',
    'historicalCompletionRate',
    'taskDecompositionPotential',
    'energyToRewardRatio',
    'timeSensitivity',
  ] as const) {
    merged[key] = clamp01(merged[key]);
  }
  return merged;
}

function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function toLocalInputValue(ts: number): string {
  const d = new Date(ts);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export type { Effort, FocusType, TaskTag, DeadlineType };
