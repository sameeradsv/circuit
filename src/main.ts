import { recordCompletion } from './behavioral-engine';
import { taskFromConversationalInput } from './ai-assistance';
import { initCalendar, renderCalendarView } from './app/calendar';
import { buildDashboardState, renderDashboard } from './app/dashboard';
import { getMode, initModes } from './app/modes';
import { getCurrentPage, initNavigation, showPage } from './app/navigation';
import { tasksFromImport } from './app/import';
import { bindTaskDetailForm, renderTaskDetailRows, renderTaskList, type ViewMode } from './app/render';
import { mergeTaskDimensions, readDimensionOverrides } from './app/dimensions';
import { buildTaskFromInput, initTaskInput, resetTaskInput } from './app/task-input';
import { initAuthUI, storageNamespace } from './app/auth';
import { downloadSyncBundle, parseSyncBundle } from './app/sync-bundle';
import { initTheme } from './app/themes';
import { showToast } from './app/toast';
import { parseIcs, syncFromCalendar, tasksToIcs } from './calendar-sync';
import { handleSkip, handleSplit, rescheduleAll } from './rescheduling-engine';
import {
  createTask,
  filterTasks,
  loadTasks,
  saveTasks,
  setTaskStorageNamespace,
  type TaskFilter,
} from './task-engine';
import type { ScheduleContext, ScoredTask, Task, TaskTag } from './types';

let tasks: Task[] = [];
let currentFilter: TaskFilter = 'all';
let selectedTag: TaskTag = 'general';
let viewMode: ViewMode = 'list';
let scheduleOrder = new Map<string, number>();
let lastPlan: ReturnType<typeof buildDashboardState> | null = null;

const form = document.getElementById('task-form') as HTMLFormElement;
const input = document.getElementById('task-input') as HTMLInputElement;
const list = document.getElementById('task-list') as HTMLUListElement;
const filterButtons = document.querySelectorAll('.filters button');
const tagButtons = document.querySelectorAll('.tag-btn');

function scheduleContext(): ScheduleContext {
  return {
    mode: getMode(),
    now: Date.now(),
    availableMinutes: 240,
    completedToday: tasks.filter(
      (t) => t.completed && t.updatedAt > startOfDay(Date.now()),
    ).length,
  };
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function refreshSchedule(): void {
  lastPlan = buildDashboardState(tasks, getMode());
  scheduleOrder = new Map(lastPlan.plan.ordered.map((s, i) => [s.task.id, i]));
}

function persist(): void {
  saveTasks(tasks);
  refreshSchedule();
  if (lastPlan) renderDashboard(lastPlan);
  renderTasks();
  renderCalendarView(tasks);
}

function load(): void {
  tasks = loadTasks();
  tasks = rescheduleAll(tasks, getMode()).tasks;
  saveTasks(tasks);
  refreshSchedule();
  if (lastPlan) renderDashboard(lastPlan);
  renderTasks();
}

function scoreMap(): Map<string, ScoredTask> {
  if (!lastPlan) return new Map();
  return new Map(lastPlan.plan.ordered.map((s) => [s.task.id, s]));
}

function addTaskFromInput(text: string): void {
  const conversational = taskFromConversationalInput(text);
  const task = conversational ?? buildTaskFromInput(text, selectedTag);
  if (conversational) {
    task.tag = selectedTag;
  }
  tasks.push(task);
  showToast(conversational ? 'Parsed task with smart defaults' : 'Task added');
  resetTaskInput(selectedTag);
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
  showToast('Task removed');
  persist();
}

function skipTaskById(id: string): void {
  const { tasks: next, changes } = handleSkip(tasks, id);
  tasks = next;
  showToast(changes[0] ?? 'Task rescheduled');
  persist();
}

function splitTaskById(id: string): void {
  const { tasks: next, changes } = handleSplit(tasks, id);
  tasks = next;
  showToast(changes[0] ?? 'Task split');
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

function openDetailModal(taskId: string): void {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  const overlay = document.getElementById('detail-overlay');
  const title = document.getElementById('detail-title');
  const rows = document.getElementById('detail-rows');
  if (!overlay || !title || !rows) return;

  title.textContent = task.text;
  rows.innerHTML = renderTaskDetailRows(task, scoreMap().get(task.id));
  bindTaskDetailForm(rows);
  overlay.removeAttribute('hidden');
  bindDetailModal(task.id, overlay);

  const close = () => overlay.setAttribute('hidden', '');
  document.getElementById('detail-close')?.addEventListener('click', close, { once: true });
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };
}

function bindDetailModal(taskId: string, overlay: HTMLElement): void {
  const saveBtn = document.getElementById('detail-save');
  const close = () => overlay.setAttribute('hidden', '');
  if (!saveBtn) return;

  saveBtn.onclick = () => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const overrides = readDimensionOverrides('detail', task);
    const merged = mergeTaskDimensions(task, overrides);
    Object.assign(task, merged);

    showToast('Task details updated');
    persist();
    close();
  };
}

function renderTasks(): void {
  const visible = visibleTasks();
  const emptyMsgs: Record<TaskFilter, string> = {
    all: 'No tasks yet. Add one above!',
    pending: 'All caught up! No pending tasks.',
    completed: 'Nothing completed yet.',
    today: 'Nothing urgent for today.',
    scheduled: 'No scheduled tasks.',
  };

  if (visible.length === 0) {
    list.innerHTML = '';
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = emptyMsgs[currentFilter] ?? 'No tasks here.';
    list.appendChild(empty);
    return;
  }

  renderTaskList(list, visible, {
    scoreMap: scoreMap(),
    scheduleOrder,
    onToggle: toggleTask,
    onDelete: deleteTask,
    onSkip: skipTaskById,
    onSplit: splitTaskById,
    onTinyStep: openTinyStepModal,
    onDetails: openDetailModal,
  }, viewMode);

}

document.getElementById('schedule-list')?.addEventListener('click', (e) => {
  const item = (e.target as HTMLElement).closest('.schedule-item');
  if (!item) return;
  const id = (item as HTMLElement).dataset.taskId;
  if (id) openDetailModal(id);
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  addTaskFromInput(text);
  input.focus();
  showPage('tasks');
});

filterButtons.forEach((btn) => {
  btn.addEventListener('click', () => setFilter((btn as HTMLElement).dataset.filter as TaskFilter));
});

tagButtons.forEach((btn) => {
  btn.addEventListener('click', () => setTag((btn as HTMLElement).dataset.tag as TaskTag));
});

document.getElementById('view-list')?.addEventListener('click', () => {
  viewMode = 'list';
  document.getElementById('view-list')?.classList.add('active');
  document.getElementById('view-grouped')?.classList.remove('active');
  renderTasks();
});

document.getElementById('view-grouped')?.addEventListener('click', () => {
  viewMode = 'grouped';
  document.getElementById('view-grouped')?.classList.add('active');
  document.getElementById('view-list')?.classList.remove('active');
  renderTasks();
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
      showToast(`Imported ${imported.length} tasks`);
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

const calendarInput = document.getElementById('calendar-file-input') as HTMLInputElement | null;
const calendarImport = document.getElementById('calendar-import');
const calendarExport = document.getElementById('calendar-export');
const calendarStatus = document.getElementById('calendar-sync-status');

calendarImport?.addEventListener('click', () => calendarInput?.click());

calendarInput?.addEventListener('change', async () => {
  const file = calendarInput.files?.[0];
  if (!file) return;
  try {
    const events = parseIcs(await file.text());
    const result = syncFromCalendar(tasks, events);
    tasks = result.tasks;
    showToast(`Imported ${result.imported} calendar tasks`);
    if (calendarStatus) {
      calendarStatus.textContent = `${result.imported} imported, ${result.skipped} skipped`;
    }
    persist();
  } catch {
    if (calendarStatus) calendarStatus.textContent = 'Calendar import failed';
    showToast('Calendar import failed');
  }
  calendarInput.value = '';
});

calendarExport?.addEventListener('click', () => {
  const ics = tasksToIcs(tasks);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'circuit-plan.ics';
  link.click();
  URL.revokeObjectURL(url);
  if (calendarStatus) calendarStatus.textContent = 'Exported scheduled tasks';
  showToast('Calendar file exported');
});

const bundleInput = document.getElementById('bundle-file-input') as HTMLInputElement | null;
const bundleExport = document.getElementById('bundle-export');
const bundleImport = document.getElementById('bundle-import');

bundleExport?.addEventListener('click', () => {
  downloadSyncBundle(tasks);
  showToast('Account backup downloaded');
});

bundleImport?.addEventListener('click', () => bundleInput?.click());

bundleInput?.addEventListener('change', async () => {
  const file = bundleInput.files?.[0];
  if (!file) return;
  try {
    const bundle = parseSyncBundle(await file.text());
    tasks = bundle.tasks;
    persist();
    showToast(`Restored ${bundle.tasks.length} tasks from backup`);
  } catch {
    showToast('Invalid backup file');
  }
  bundleInput.value = '';
});

function bootstrapApp(): void {
  initTheme();
  initTaskInput(setTag);
  load();
  initNavigation((page) => {
    if (page === 'add') {
      input?.focus();
    }
  });
  initCalendar({
    onTaskClick: openDetailModal,
    onDateChange: () => renderCalendarView(tasks),
  });
  initModes(() => {
    tasks = rescheduleAll(tasks, getMode()).tasks;
    persist();
  });

  if (getCurrentPage() === 'add') {
    input?.focus();
  }
}

initAuthUI((session) => {
  setTaskStorageNamespace(storageNamespace(session));
  bootstrapApp();
});
