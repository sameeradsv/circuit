import { createTask } from '../task-engine';
import type { Task, TaskTag } from '../types';
import {
  applyOverridesToForm,
  bindRangeLabels,
  fieldId,
  mergeTaskDimensions,
  readDimensionOverrides,
  renderDimensionSections,
} from './dimensions';
import { TASK_PRESET_IDS, TASK_PRESETS, type TaskPresetId } from './task-presets';

let activePreset: TaskPresetId | null = null;
let onPresetTagChange: ((tag: TaskTag) => void) | null = null;

export function initTaskInput(onTagChange?: (tag: TaskTag) => void): void {
  onPresetTagChange = onTagChange ?? null;

  const presetRow = document.getElementById('preset-row');
  const dimensionsRoot = document.getElementById('add-dimensions-root');
  if (!presetRow || !dimensionsRoot) return;

  presetRow.innerHTML = TASK_PRESET_IDS.map((id) => {
    const preset = TASK_PRESETS[id];
    return `<button type="button" class="preset-btn" data-preset="${id}" title="${preset.hint}">${preset.label}</button>`;
  }).join('');

  const defaults = createTask('');
  dimensionsRoot.innerHTML = renderDimensionSections('add', defaults);
  bindRangeLabels(dimensionsRoot);

  presetRow.querySelectorAll<HTMLButtonElement>('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.preset as TaskPresetId;
      applyPreset(id);
      presetRow.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

export function applyPreset(id: TaskPresetId): void {
  const preset = TASK_PRESETS[id];
  activePreset = id;

  const input = document.getElementById('task-input') as HTMLInputElement | null;
  if (input && !input.value.trim()) {
    input.placeholder = preset.placeholder;
  }

  const defaults = createTask('', preset.defaults);
  applyOverridesToForm('add', defaults);

  if (preset.defaults.tag) onPresetTagChange?.(preset.defaults.tag);
}

export function getActivePreset(): TaskPresetId | null {
  return activePreset;
}

export function buildTaskFromInput(text: string, tag: TaskTag): Task {
  const base = createTask(text, { tag });
  const overrides = readDimensionOverrides('add', base);
  return mergeTaskDimensions(base, { ...overrides, tag: (overrides.tag as TaskTag | undefined) ?? tag });
}

export function resetTaskInput(tag: TaskTag): void {
  const input = document.getElementById('task-input') as HTMLInputElement | null;
  if (input) {
    input.value = '';
    input.placeholder = 'Capture a task, deadline, or plan';
  }

  activePreset = null;
  document.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active'));
  applyOverridesToForm('add', createTask('', { tag }));

  const tiny = document.getElementById(fieldId('add', 'tinyStep')) as HTMLInputElement | null;
  if (tiny) tiny.value = '';
}
