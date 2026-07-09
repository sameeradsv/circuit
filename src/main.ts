import { recordCompletion } from './behavioral-engine';
import { taskFromConversationalInput } from './ai-assistance';
import { parseUtterance } from './ai-assistance/parse-utterance';
import { parseTaskWithAI } from './ai-assistance/conversational';
import { getAISuggestions } from './ai-assistance/suggestions';
import { initCalendar, renderCalendarView } from './app/calendar';
import { buildDashboardState, fetchAIBriefing, renderDashboard } from './app/dashboard';
import { getMode, initModes } from './app/modes';
import { getCurrentPage, initNavigation, setPageHooks, showPage } from './app/navigation';
import { renderAnalyticsPage, renderEnergyPage } from './app/analytics-page';
import { initVoiceInput } from './app/voice-input';
import { tasksFromImport } from './app/import';
import { bindTaskDetailForm, renderTaskDetailRows, renderTaskList, type ViewMode } from './app/render';
import { mergeTaskDimensions, readDimensionOverrides } from './app/dimensions';
import { buildTaskFromInput, initTaskInput, resetTaskInput } from './app/task-input';
import { getPasscodeForSession, initAuthUI, storageNamespace } from './app/auth';
import { copySyncBundleToClipboard, downloadSyncBundle, parseSyncBundle, readSyncBundleFromClipboard } from './app/sync-bundle';
import { getCloudEndpoint, pullFromCloud, pushToCloud, setCloudEndpoint } from './app/cloud-sync';
import { getAIKey, setAIKey, isAIConfigured } from './app/ai-config';
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
import type { ScoredTask, Task, TaskTag } from './types';

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

async function addTaskFromInput(text: string): Promise<void> {
  let task: Task;
  const utterance = parseUtterance(text);
  if (isAIConfigured()) {
    try {
      const ai = await parseTaskWithAI(text);
      task = createTask(ai.text, {
        tag: (ai.tag as TaskTag | undefined) ?? (utterance.tag as TaskTag) ?? selectedTag,
        duration: ai.duration ?? utterance.duration,
        deadlineType: ai.deadlineType ?? 'none',
        urgency: ai.urgency ?? utterance.urgency,
        cognitiveLoad: ai.cognitiveLoad ?? utterance.cognitive_load,
        effort: utterance.effort,
      });
      task.tag = selectedTag;
      showToast('Task parsed with AI');
    } catch {
      task = taskFromUtterance(utterance);
      showToast('Parsed task with smart defaults');
    }
  } else {
    task = taskFromUtterance(utterance);
    showToast('Task added');
  }
  tasks.push(task);
  resetTaskInput(selectedTag);
  persist();
}

function taskFromUtterance(utterance: ReturnType<typeof parseUtterance>): Task {
  const conversational = taskFromConversationalInput(utterance.text);
  const base = conversational ?? buildTaskFromInput(utterance.text, (utterance.tag as TaskTag) ?? selectedTag);
  return {
    ...base,
    tag: (utterance.tag as TaskTag) ?? base.tag,
    urgency: utterance.urgency ?? base.urgency,
    importance: utterance.importance ?? base.importance,
    duration: utterance.duration ?? base.duration,
    cognitiveLoad: utterance.cognitive_load ?? base.cognitiveLoad,
    effort: utterance.effort ?? base.effort,
    scheduledAt: utterance.scheduledAt ?? base.scheduledAt,
  };
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
  void addTaskFromInput(text).then(() => {
    input.focus();
    showPage('tasks');
  });
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

document.getElementById('bundle-copy')?.addEventListener('click', async () => {
  try {
    await copySyncBundleToClipboard(tasks);
    showToast('Backup copied to clipboard');
  } catch {
    showToast('Could not copy to clipboard');
  }
});

document.getElementById('bundle-paste')?.addEventListener('click', async () => {
  try {
    const bundle = await readSyncBundleFromClipboard();
    const date = new Date(bundle.exportedAt).toLocaleDateString();
    tasks = bundle.tasks;
    persist();
    showToast(`Imported ${bundle.tasks.length} tasks from clipboard backup (${date})`);
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Could not paste backup');
  }
});

const syncEndpointInput = document.getElementById('sync-endpoint-input') as HTMLInputElement | null;
const cloudStatus = document.getElementById('cloud-sync-status');

function setCloudStatus(msg: string): void {
  if (cloudStatus) cloudStatus.textContent = msg;
}

if (syncEndpointInput) {
  const saved = getCloudEndpoint();
  if (saved) syncEndpointInput.value = saved;
}

document.getElementById('sync-endpoint-save')?.addEventListener('click', () => {
  const url = syncEndpointInput?.value.trim() ?? '';
  setCloudEndpoint(url);
  setCloudStatus(url ? 'Sync URL saved' : 'Sync URL cleared');
});

async function requirePasscode(): Promise<string | null> {
  const inMemory = getPasscodeForSession();
  if (inMemory) return inMemory;
  return new Promise((resolve) => {
    const pc = prompt('Enter your passcode to sync:');
    resolve(pc && pc.length >= 4 ? pc : null);
  });
}

async function cloudSync(direction: 'push' | 'pull'): Promise<void> {
  const endpoint = getCloudEndpoint();
  if (!endpoint) {
    showToast('Set a sync URL first');
    return;
  }
  const session = (() => {
    try {
      const raw = localStorage.getItem('circuit_session_v1');
      return raw ? (JSON.parse(raw) as { username?: string; isLocal?: boolean }) : null;
    } catch {
      return null;
    }
  })();
  if (!session || session.isLocal) {
    showToast('Sign in with an account to use cloud sync');
    return;
  }
  const username = session.username!;
  const passcode = await requirePasscode();
  if (!passcode) {
    showToast('Passcode required for cloud sync');
    return;
  }

  try {
    if (direction === 'push') {
      await pushToCloud(tasks, username, passcode, endpoint);
      setCloudStatus(`Pushed ${tasks.length} tasks`);
      showToast(`Pushed ${tasks.length} tasks to cloud`);
    } else {
      const bundle = await pullFromCloud(username, passcode, endpoint);
      if (!bundle) {
        showToast('No remote backup found');
        setCloudStatus('No remote backup');
        return;
      }
      if (bundle.exportedAt > (tasks[0]?.updatedAt ?? 0)) {
        tasks = bundle.tasks;
        persist();
        setCloudStatus(`Pulled ${bundle.tasks.length} tasks`);
        showToast(`Pulled ${bundle.tasks.length} tasks from cloud`);
      } else {
        await pushToCloud(tasks, username, passcode, endpoint);
        setCloudStatus('Local is newer — pushed');
        showToast('Local tasks are newer — pushed to cloud');
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Sync failed';
    setCloudStatus(msg);
    showToast(msg);
  }
}

document.getElementById('cloud-push')?.addEventListener('click', () => void cloudSync('push'));
document.getElementById('cloud-pull')?.addEventListener('click', () => void cloudSync('pull'));

const aiKeyInput = document.getElementById('ai-key-input') as HTMLInputElement | null;
const aiKeyStatus = document.getElementById('ai-key-status');

if (aiKeyInput) {
  const saved = getAIKey();
  if (saved) aiKeyInput.value = saved;
}

document.getElementById('ai-key-save')?.addEventListener('click', () => {
  const key = aiKeyInput?.value.trim() ?? '';
  setAIKey(key);
  if (aiKeyStatus) aiKeyStatus.textContent = key ? 'AI key saved' : 'AI key cleared';
});

const aiSuggestionsShown = new Set<string>();

async function maybeShowAISuggestions(): Promise<void> {
  if (!isAIConfigured() || tasks.length === 0) return;
  try {
    const suggestions = await getAISuggestions(tasks, getMode());
    if (suggestions.length === 0) return;
    const panel = document.getElementById('insight-panel');
    if (!panel) return;
    const newSuggestions = suggestions.filter((s) => !aiSuggestionsShown.has(s));
    if (newSuggestions.length === 0) return;
    newSuggestions.forEach((s) => aiSuggestionsShown.add(s));
    const frag = newSuggestions
      .map(
        (s) =>
          `<p class="insight-line insight-rec"><span class="insight-icon">✦</span>${s}</p>`,
      )
      .join('');
    panel.insertAdjacentHTML('beforeend', frag);
  } catch {
    // Silent fail — AI suggestions are optional
  }
}

function bootstrapApp(): void {
  initTheme();
  initTaskInput(setTag);
  initVoiceInput('task-input', 'task-form');
  load();
  setPageHooks({
    onAnalytics: () => renderAnalyticsPage(tasks),
    onEnergy: () => {
      const plan = lastPlan?.plan;
      renderEnergyPage(
        tasks,
        plan?.workloadMinutes ?? 0,
        lastPlan?.ctx.availableMinutes ?? 240,
      );
    },
  });
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

  if (isAIConfigured()) {
    void fetchAIBriefing(tasks, getMode());
    void maybeShowAISuggestions();
  }
}

initAuthUI((session) => {
  setTaskStorageNamespace(storageNamespace(session));
  bootstrapApp();

  // Auto-sync on login when passcode is available (just signed in, not page-reload)
  if (!session.isLocal) {
    const endpoint = getCloudEndpoint();
    const passcode = getPasscodeForSession();
    if (endpoint && passcode) {
      void cloudSync('pull');
    }
  }
});
