import { recordCompletion } from './behavioral-engine';
import { taskFromConversationalInput } from './ai-assistance';
import { getMode, initModes } from './app/modes';
import { tasksFromImport } from './app/import';
import { initTheme } from './app/themes';
import { computeAnalytics } from './analytics-engine';
import { getRecommendations } from './recommendation-engine';
import { handleSkip, handleSplit, rescheduleAll } from './rescheduling-engine';
import { buildSchedule } from './scheduling-engine';
import {
  createTask,
  filterTasks,
  loadTasks,
  saveTasks,
  type TaskFilter,
} from './task-engine';
import type { ScheduleContext, Task, TaskTag } from './types';

let tasks: Task[] = [];
let currentFilter: TaskFilter = 'all';
let selectedTag: TaskTag = 'general';
let scheduleOrder: Map<string, number> = new Map();

const form = document.getElementById('task-form') as HTMLFormElement;
const input = document.getElementById('task-input') as HTMLInputElement;
const list = document.getElementById('task-list') as HTMLUListElement;
const filterButtons = document.querySelectorAll('.filters button');
const tagButtons = document.querySelectorAll('.tag-btn');

function refreshSchedule(): void {
  const ctx: ScheduleContext = {
    mode: getMode(),
    now: Date.now(),
    availableMinutes: 240,
    completedToday: tasks.filter(
      (t) => t.completed && t.updatedAt > startOfDay(Date.now()),
    ).length,
  };
  const plan = buildSchedule(tasks, ctx);
  scheduleOrder = new Map(plan.ordered.map((s, i) => [s.task.id, i]));
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function persist(): void {
  saveTasks(tasks);
  refreshSchedule();
  renderTasks();
  updateSnapshot();
}

function load(): void {
  tasks = loadTasks();
  const { tasks: rescheduled } = rescheduleAll(tasks, getMode());
  tasks = rescheduled;
  saveTasks(tasks);
  refreshSchedule();
  renderTasks();
  updateSnapshot();
}

function addTaskFromInput(text: string): void {
  const conversational = taskFromConversationalInput(text);
  const task = conversational ?? createTask(text, { tag: selectedTag });
  if (!conversational) {
    task.tag = selectedTag;
  }
  tasks.push(task);
  persist();
}

function toggleTask(id: string): void {
  tasks = tasks.map((t) => {
    if (t.id !== id) return t;
    if (t.completed) return { ...t, completed: false, updatedAt: Date.now() };
    return recordCompletion(t);
  });
  tasks = rescheduleAll(tasks, getMode()).tasks;
  persist();
}

function deleteTask(id: string): void {
  tasks = tasks.filter((t) => t.id !== id);
  persist();
}

function skipTaskById(id: string): void {
  const { tasks: next } = handleSkip(tasks, id);
  tasks = next;
  persist();
}

function setFilter(filter: TaskFilter): void {
  currentFilter = filter;
  filterButtons.forEach((btn) => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.filter === filter);
  });
  renderTasks();
}

function setTag(tag: TaskTag): void {
  selectedTag = tag;
  tagButtons.forEach((btn) => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.tag === tag);
  });
}

function visibleTasks(): Task[] {
  const filtered = filterTasks(tasks, currentFilter, getMode());
  return [...filtered].sort((a, b) => {
    const ao = scheduleOrder.get(a.id) ?? 999;
    const bo = scheduleOrder.get(b.id) ?? 999;
    return ao - bo;
  });
}

function updateSnapshot(): void {
  const banner = document.getElementById('snapshot-banner');
  if (!banner) return;

  const recs = getRecommendations(tasks, getMode());
  const analytics = computeAnalytics(tasks);
  const headline = recs[0]?.headline;

  if (headline) {
    banner.textContent = headline;
  } else {
    banner.textContent = `${analytics.pending} pending · ~${analytics.totalPendingMinutes} min`;
  }
  banner.style.display = 'block';

  const insightEl = document.getElementById('insight-panel');
  if (insightEl) {
    insightEl.innerHTML = recs
      .slice(0, 3)
      .map((r) => `<p class="insight-line">${escapeHtml(r.headline)}</p>`)
      .join('');
  }
}

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function openTinyStepModal(taskId: string): void {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  const overlay = document.getElementById('nts-overlay');
  const taskName = document.getElementById('nts-task-name');
  const ntsInput = document.getElementById('nts-input') as HTMLInputElement;
  if (!overlay || !taskName || !ntsInput) return;
  taskName.textContent = task.text;
  ntsInput.value = task.tinyStep;
  overlay.removeAttribute('hidden');
  ntsInput.focus();

  const saveBtn = document.getElementById('nts-save');
  const cancelBtn = document.getElementById('nts-cancel');
  const save = () => {
    task.tinyStep = ntsInput.value.trim();
    task.updatedAt = Date.now();
    persist();
    overlay.setAttribute('hidden', '');
  };
  const cancel = () => overlay.setAttribute('hidden', '');
  if (saveBtn) saveBtn.onclick = save;
  if (cancelBtn) cancelBtn.onclick = cancel;
  overlay.onclick = (e) => {
    if (e.target === overlay) cancel();
  };
}

function renderTasks(): void {
  list.innerHTML = '';
  const visible = visibleTasks();

  if (visible.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    const msgs: Record<TaskFilter, string> = {
      all: 'No tasks yet. Add one above!',
      pending: 'All caught up! No pending tasks.',
      completed: 'Nothing completed yet.',
      today: 'Nothing urgent for today.',
      scheduled: 'No scheduled tasks.',
    };
    empty.textContent = msgs[currentFilter] ?? 'No tasks here.';
    list.appendChild(empty);
    return;
  }

  const ctx: ScheduleContext = {
    mode: getMode(),
    now: Date.now(),
    availableMinutes: 240,
    completedToday: 0,
  };
  const plan = buildSchedule(tasks, ctx);
  const scoreMap = new Map(plan.ordered.map((s) => [s.task.id, s]));

  for (const task of visible) {
    const li = document.createElement('li');
    li.className = 'task-item' + (task.completed ? ' completed' : '');
    const rank = scheduleOrder.get(task.id);
    if (rank === 0 && !task.completed) li.classList.add('task-priority');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.completed;
    checkbox.setAttribute('aria-label', 'Mark task complete');
    checkbox.addEventListener('change', () => toggleTask(task.id));

    const content = document.createElement('div');
    content.className = 'task-content';

    const span = document.createElement('span');
    span.className = 'task-text';
    span.textContent = task.text;
    content.appendChild(span);

    if (task.tinyStep) {
      const step = document.createElement('div');
      step.className = 'tiny-step';
      step.textContent = '→ ' + task.tinyStep;
      content.appendChild(step);
    }

    const scored = scoreMap.get(task.id);
    if (scored && scored.reasons.length && !task.completed) {
      const hint = document.createElement('div');
      hint.className = 'schedule-hint';
      hint.textContent = scored.reasons.join(' · ');
      content.appendChild(hint);
    }

    const tagBadge = document.createElement('span');
    tagBadge.className = 'task-tag-badge';
    tagBadge.textContent = task.tag;
    content.appendChild(tagBadge);

    const actions = document.createElement('div');
    actions.className = 'task-actions';

    if (!task.completed) {
      const stepBtn = document.createElement('button');
      stepBtn.textContent = '⚡';
      stepBtn.title = 'Set next tiny step';
      stepBtn.addEventListener('click', () => openTinyStepModal(task.id));
      actions.appendChild(stepBtn);

      if (task.effort === 'high') {
        const splitBtn = document.createElement('button');
        splitBtn.textContent = '⑂';
        splitBtn.title = 'Split task';
        splitBtn.addEventListener('click', () => {
          const { tasks: next } = handleSplit(tasks, task.id);
          tasks = next;
          persist();
        });
        actions.appendChild(splitBtn);
      }

      const skipBtn = document.createElement('button');
      skipBtn.textContent = '↷';
      skipBtn.title = 'Skip / reschedule';
      skipBtn.addEventListener('click', () => skipTaskById(task.id));
      actions.appendChild(skipBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.setAttribute('aria-label', 'Delete task');
    delBtn.addEventListener('click', () => deleteTask(task.id));
    actions.appendChild(delBtn);

    li.appendChild(checkbox);
    li.appendChild(content);
    li.appendChild(actions);
    list.appendChild(li);
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  addTaskFromInput(text);
  input.value = '';
  input.focus();
});

filterButtons.forEach((btn) => {
  btn.addEventListener('click', () => setFilter((btn as HTMLElement).dataset.filter as TaskFilter));
});

tagButtons.forEach((btn) => {
  btn.addEventListener('click', () => setTag((btn as HTMLElement).dataset.tag as TaskTag));
});

const fileInput = document.getElementById('file-input') as HTMLInputElement;
const importBtn = document.querySelector('.import-btn');
const importStatus = document.getElementById('import-status');

if (fileInput && importBtn) {
  importBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (importStatus) {
      importStatus.textContent = 'Processing...';
      importStatus.style.display = 'block';
    }
    try {
      const text = await file.text();
      const imported = tasksFromImport(text);
      tasks.push(...imported);
      persist();
      if (importStatus) {
        importStatus.textContent = `✅ Imported ${imported.length} tasks`;
        setTimeout(() => {
          importStatus.style.display = 'none';
        }, 3000);
      }
    } catch {
      if (importStatus) importStatus.textContent = '❌ Error processing file';
    }
    fileInput.value = '';
  });
}

initTheme();
load();
initModes(() => {
  tasks = rescheduleAll(tasks, getMode()).tasks;
  persist();
});

