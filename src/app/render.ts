import { groupTasksByTag } from '../task-engine';
import type { ScoredTask, Task } from '../types';

export type ViewMode = 'list' | 'grouped';

export interface RenderContext {
  scoreMap: Map<string, ScoredTask>;
  scheduleOrder: Map<string, number>;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onSkip: (id: string) => void;
  onSplit: (id: string) => void;
  onTinyStep: (id: string) => void;
  onDetails: (id: string) => void;
}

export function renderTaskList(
  list: HTMLUListElement,
  tasks: Task[],
  ctx: RenderContext,
  viewMode: ViewMode,
): void {
  list.innerHTML = '';
  if (tasks.length === 0) return;

  if (viewMode === 'grouped') {
    const groups = groupTasksByTag(tasks);
    for (const [tag, groupTasks] of Object.entries(groups)) {
      const header = document.createElement('li');
      header.className = 'group-header';
      header.textContent = tag.charAt(0).toUpperCase() + tag.slice(1);
      list.appendChild(header);
      for (const task of groupTasks) list.appendChild(buildTaskItem(task, ctx));
    }
    return;
  }

  for (const task of tasks) list.appendChild(buildTaskItem(task, ctx));
}

export function renderTaskDetailRows(task: Task, scored?: ScoredTask): string {
  const scheduledValue = task.scheduledAt ? toLocalInputValue(task.scheduledAt) : '';
  const recurrence = task.recurrence ?? '';
  const knownRecurrence = ['daily', 'weekly', 'monthly', 'weekdays'].includes(recurrence);
  const rows: [string, string][] = [
    [
      'Duration',
      `<input id="detail-duration" type="number" min="5" max="480" step="5" value="${task.duration}" />`,
    ],
    ['Effort', select('detail-effort', ['low', 'medium', 'high'], task.effort)],
    ['Focus', select('detail-focus', ['deep', 'shallow', 'admin', 'creative'], task.focusType)],
    ['Deadline', select('detail-deadline', ['none', 'soft', 'hard'], task.deadlineType)],
    ['Scheduled', `<input id="detail-scheduled" type="datetime-local" value="${scheduledValue}" />`],
    [
      'Recurrence',
      `${select(
        'detail-recurrence',
        ['', 'daily', 'weekly', 'monthly', 'weekdays', 'custom'],
        knownRecurrence ? recurrence : recurrence ? 'custom' : '',
        ['None', 'Daily', 'Weekly', 'Monthly', 'Weekdays', 'Custom'],
      )}
       <input id="detail-recurrence-custom" class="detail-custom-recurrence" type="text" placeholder="FREQ=WEEKLY;BYDAY=MO" value="${knownRecurrence ? '' : escapeAttr(recurrence)}" />`,
    ],
    ['Importance', pct(task.importance)],
    ['Urgency', pct(task.urgency)],
    ['Cognitive load', pct(task.cognitiveLoad)],
    ['Emotional resistance', pct(task.emotionalResistance)],
    ['Momentum', pct(task.momentumValue)],
    ['Completion rate', pct(task.historicalCompletionRate)],
    ['Energy / reward', pct(task.energyToRewardRatio)],
  ];

  if (task.preferredExecutionWindow) rows.push(['Best window', task.preferredExecutionWindow]);
  if (task.skippedCount > 0) rows.push(['Skipped', String(task.skippedCount)]);
  if (scored) {
    rows.push(['Schedule score', String(Math.round(scored.score))]);
    if (scored.reasons.length) rows.push(['Why now', scored.reasons.join(', ')]);
  }

  return rows.map(([k, v]) => `<label class="detail-row"><span>${k}</span><span>${v}</span></label>`).join('');
}

function buildTaskItem(task: Task, ctx: RenderContext): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'task-item' + (task.completed ? ' completed' : '');
  const rank = ctx.scheduleOrder.get(task.id);
  if (rank === 0 && !task.completed) li.classList.add('task-priority');
  if (task.skippedCount > 0 && !task.completed) li.classList.add('task-skipped');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.completed;
  checkbox.setAttribute('aria-label', 'Mark task complete');
  checkbox.addEventListener('change', () => ctx.onToggle(task.id));

  const content = document.createElement('div');
  content.className = 'task-content';

  const topRow = document.createElement('div');
  topRow.className = 'task-top-row';
  if (rank !== undefined && !task.completed) {
    const rankBadge = document.createElement('span');
    rankBadge.className = 'rank-badge';
    rankBadge.textContent = '#' + (rank + 1);
    topRow.appendChild(rankBadge);
  }

  const text = document.createElement('span');
  text.className = 'task-text';
  text.textContent = task.text;
  topRow.appendChild(text);
  content.appendChild(topRow);

  if (task.tinyStep) {
    const step = document.createElement('div');
    step.className = 'tiny-step';
    step.textContent = 'Next: ' + task.tinyStep;
    content.appendChild(step);
  }

  const scored = ctx.scoreMap.get(task.id);
  if (scored && !task.completed) {
    const hint = document.createElement('div');
    hint.className = 'schedule-hint';
    hint.textContent = scored.reasons.length ? scored.reasons.join(' / ') : 'score ' + Math.round(scored.score);
    content.appendChild(hint);
    content.appendChild(makeScoreBar(scored.score));
  }

  const chips = document.createElement('div');
  chips.className = 'task-chips';
  appendChip(chips, task.tag);
  appendChip(chips, task.duration + 'm');
  appendChip(chips, task.effort);
  appendChip(chips, task.focusType);
  if (task.preferredExecutionWindow) appendChip(chips, task.preferredExecutionWindow);
  if (task.recurrence) appendChip(chips, task.recurrence, 'chip-recurring');
  if (task.skippedCount > 0) appendChip(chips, 'skipped x' + task.skippedCount, 'chip-warn');
  if (task.scheduledAt && !task.completed) appendChip(chips, formatScheduled(task.scheduledAt), 'chip-scheduled');
  content.appendChild(chips);

  if (!task.completed) content.appendChild(makeLoadBar(task.cognitiveLoad));

  const actions = document.createElement('div');
  actions.className = 'task-actions';
  if (!task.completed) {
    actions.appendChild(actionBtn('i', 'View details', () => ctx.onDetails(task.id)));
    actions.appendChild(actionBtn('+', 'Set tiny step', () => ctx.onTinyStep(task.id)));
    if (task.effort === 'high' || task.taskDecompositionPotential >= 0.5) {
      actions.appendChild(actionBtn('/', 'Split task', () => ctx.onSplit(task.id)));
    }
    actions.appendChild(actionBtn('~', 'Skip', () => ctx.onSkip(task.id)));
  }
  actions.appendChild(actionBtn('x', 'Delete task', () => ctx.onDelete(task.id), true));

  li.appendChild(checkbox);
  li.appendChild(content);
  li.appendChild(actions);
  return li;
}

function makeScoreBar(score: number): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'score-bar task-score-bar';
  bar.style.setProperty('--score', Math.min(100, Math.max(5, Math.round(score))) + '%');
  bar.appendChild(document.createElement('span'));
  return bar;
}

function makeLoadBar(load: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'load-row';
  const label = document.createElement('span');
  label.className = 'load-label';
  label.textContent = 'load';
  const bar = document.createElement('div');
  bar.className = 'load-bar';
  bar.style.setProperty('--load', Math.round(load * 100) + '%');
  bar.appendChild(document.createElement('span'));
  row.appendChild(label);
  row.appendChild(bar);
  return row;
}

function appendChip(parent: HTMLElement, text: string, extra = ''): void {
  const el = document.createElement('span');
  el.className = 'task-chip' + (extra ? ' ' + extra : '');
  el.textContent = text;
  parent.appendChild(el);
}

function actionBtn(label: string, title: string, onClick: () => void, del = false): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  if (del) btn.classList.add('danger-action');
  btn.addEventListener('click', onClick);
  return btn;
}

function formatScheduled(ts: number): string {
  const diff = ts - Date.now();
  if (diff < 0) return 'due now';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return 'in ' + mins + 'm';
  return 'in ' + Math.round(mins / 60) + 'h';
}

function select(id: string, values: string[], current: string, labels = values): string {
  return `<select id="${id}">${values
    .map((value, index) => `<option value="${escapeAttr(value)}"${value === current ? ' selected' : ''}>${labels[index]}</option>`)
    .join('')}</select>`;
}

function toLocalInputValue(ts: number): string {
  const d = new Date(ts);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function pct(n: number): string {
  return Math.round(n * 100) + '%';
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
