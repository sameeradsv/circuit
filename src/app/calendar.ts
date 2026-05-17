import type { Task } from '../types';

export interface CalendarHandlers {
  onTaskClick: (taskId: string) => void;
  onDateChange: (date: Date) => void;
}

let selectedDate = startOfDay(new Date());
let cachedTasks: Task[] = [];
let handlers: CalendarHandlers = {
  onTaskClick: () => {},
  onDateChange: () => {},
};

export function initCalendar(h: CalendarHandlers): void {
  handlers = h;
  document.getElementById('cal-prev')?.addEventListener('click', () => shiftDay(-1));
  document.getElementById('cal-next')?.addEventListener('click', () => shiftDay(1));
  document.getElementById('cal-today')?.addEventListener('click', () => {
    selectedDate = startOfDay(new Date());
    handlers.onDateChange(selectedDate);
    renderCalendarView(cachedTasks);
  });
}

export function getSelectedDate(): Date {
  return selectedDate;
}

export function renderCalendarView(tasks: Task[]): void {
  cachedTasks = tasks;
  const label = document.getElementById('cal-label');
  const strip = document.getElementById('cal-week-strip');
  const dayView = document.getElementById('cal-day-view');
  if (!label || !strip || !dayView) return;

  const weekStart = startOfWeek(selectedDate);
  label.textContent = formatDayHeading(selectedDate);

  strip.innerHTML = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(weekStart, i);
    const active = isSameDay(day, selectedDate);
    const count = tasksForDay(tasks, day).length;
    return `<button type="button" class="cal-day-pill${active ? ' active' : ''}" data-cal-day="${day.getTime()}">
      <span class="cal-pill-dow">${day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
      <span class="cal-pill-num">${day.getDate()}</span>
      ${count ? `<span class="cal-pill-count">${count}</span>` : ''}
    </button>`;
  }).join('');

  strip.querySelectorAll<HTMLButtonElement>('[data-cal-day]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedDate = startOfDay(Number(btn.dataset.calDay));
      handlers.onDateChange(selectedDate);
      renderCalendarView(tasks);
    });
  });

  const dayTasks = tasksForDay(tasks, selectedDate);
  const isToday = isSameDay(selectedDate, new Date());

  if (dayTasks.length === 0) {
    dayView.innerHTML = `<p class="cal-empty">${isToday ? 'Nothing scheduled for today.' : 'No tasks on this day.'}</p>`;
    return;
  }

  const timed = dayTasks.filter((t) => t.scheduledAt != null).sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
  const untimed = dayTasks.filter((t) => t.scheduledAt == null);

  const blocks: string[] = [];
  if (timed.length) {
    blocks.push(
      `<div class="cal-block"><h3 class="cal-block-title">Scheduled</h3><ul class="cal-task-list">${timed.map((t) => taskRow(t)).join('')}</ul></div>`,
    );
  }
  if (untimed.length) {
    blocks.push(
      `<div class="cal-block"><h3 class="cal-block-title">${isToday ? 'Plan (no time set)' : 'Unscheduled'}</h3><ul class="cal-task-list">${untimed.map((t) => taskRow(t)).join('')}</ul></div>`,
    );
  }
  dayView.innerHTML = blocks.join('');
  dayView.querySelectorAll<HTMLElement>('.cal-task-row').forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.dataset.taskId;
      if (id) handlers.onTaskClick(id);
    });
  });
}

function taskRow(task: Task): string {
  const time =
    task.scheduledAt != null
      ? new Date(task.scheduledAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : '';
  return `<li class="cal-task-row${task.completed ? ' completed' : ''}" data-task-id="${escapeAttr(task.id)}">
    ${time ? `<span class="cal-task-time">${escapeHtml(time)}</span>` : ''}
    <span class="cal-task-text">${escapeHtml(task.text)}</span>
    <span class="cal-task-meta">${task.duration}m · ${task.tag}</span>
  </li>`;
}

function tasksForDay(tasks: Task[], day: Date): Task[] {
  const start = startOfDay(day.getTime()).getTime();
  const end = start + 86400000;
  const todayStart = startOfDay(Date.now()).getTime();
  const isToday = start === todayStart;

  return tasks.filter((t) => {
    if (t.scheduledAt != null) {
      const at = t.scheduledAt;
      return at >= start && at < end;
    }
    if (isToday && !t.completed) return true;
    if (t.completed && t.updatedAt >= start && t.updatedAt < end) return true;
    return false;
  });
}

function shiftDay(delta: number): void {
  selectedDate = addDays(selectedDate, delta);
  handlers.onDateChange(selectedDate);
  renderCalendarView(cachedTasks);
}

function startOfDay(input: Date | number): Date {
  const d = new Date(typeof input === 'number' ? input : input.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(d: Date): Date {
  const day = new Date(d);
  const dow = day.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  day.setDate(day.getDate() + diff);
  return startOfDay(day);
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return startOfDay(next);
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDayHeading(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function escapeHtml(s: string): string {
  const el = document.createElement('div');
  el.textContent = s;
  return el.innerHTML;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}
