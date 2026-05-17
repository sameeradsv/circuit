import { analyzeBehavior } from '../behavioral-engine';
import type { BehavioralInsight } from '../types';
import { explainSchedule, forecastDay } from '../ai-assistance';
import { computeAnalytics, type TaskAnalytics } from '../analytics-engine';
import { getRecommendations, type Recommendation } from '../recommendation-engine';
import { buildSchedule } from '../scheduling-engine';
import type { DayForecast } from '../ai-assistance/predictive';
import type { EnergyMode, ScheduleContext, SchedulePlan, Task } from '../types';

export interface DashboardState {
  tasks: Task[];
  mode: EnergyMode;
  plan: SchedulePlan;
  ctx: ScheduleContext;
}

export function buildDashboardState(tasks: Task[], mode: EnergyMode): DashboardState {
  const ctx: ScheduleContext = {
    mode,
    now: Date.now(),
    availableMinutes: 240,
    completedToday: tasks.filter(
      (t) => t.completed && t.updatedAt > startOfDay(Date.now()),
    ).length,
  };
  return { tasks, mode, plan: buildSchedule(tasks, ctx), ctx };
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function renderDashboard(state: DashboardState): void {
  const { tasks, mode, plan, ctx } = state;
  const analytics = computeAnalytics(tasks);
  const forecast = forecastDay(tasks, mode);
  const recs = getRecommendations(tasks, mode);
  const behavioral = analyzeBehavior(tasks, mode);

  renderBanner(recs, analytics);
  renderStats(analytics, plan);
  renderWorkloadBar(plan, ctx);
  renderSchedulePlan(plan);
  renderForecast(forecast);
  renderInsights(recs, behavioral);
}

function renderBanner(recs: Recommendation[], analytics: TaskAnalytics): void {
  const banner = document.getElementById('snapshot-banner');
  if (!banner) return;
  banner.textContent =
    recs[0]?.headline ??
    `${analytics.pending} pending · ~${analytics.totalPendingMinutes} min planned`;
}

function renderStats(analytics: TaskAnalytics, plan: SchedulePlan): void {
  const el = document.getElementById('stats-grid');
  if (!el) return;

  const completionPct = Math.round(analytics.completionRate * 100);

  el.innerHTML = [
    statCard(String(analytics.pending), 'Pending'),
    statCard(String(analytics.completed), 'Done'),
    statCard(`${plan.workloadMinutes}m`, 'Scheduled'),
    statCard(`${completionPct}%`, 'Complete'),
  ].join('');
}

function statCard(value: string, label: string): string {
  return `<div class="stat-card"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`;
}

function renderWorkloadBar(plan: SchedulePlan, ctx: ScheduleContext): void {
  const bar = document.getElementById('workload-bar');
  const label = document.getElementById('workload-label');
  if (!bar || !label) return;

  const pct = Math.min(100, Math.round((plan.workloadMinutes / ctx.availableMinutes) * 100));
  const fill = bar.querySelector('.workload-fill') as HTMLElement | null;
  if (fill) {
    fill.style.width = `${pct}%`;
    fill.classList.toggle('overload', pct >= 100);
  }
  label.textContent = `${plan.workloadMinutes} / ${ctx.availableMinutes} min capacity`;
}

function renderSchedulePlan(plan: SchedulePlan): void {
  const list = document.getElementById('schedule-list');
  const explain = document.getElementById('schedule-explain');
  if (!list) return;

  if (plan.ordered.length === 0) {
    list.innerHTML = '<li class="schedule-empty">Add tasks to generate a plan</li>';
  } else {
    list.innerHTML = plan.ordered
      .slice(0, 6)
      .map((s, i) => {
        const scoreW = Math.min(100, Math.max(8, Math.round(s.score)));
        const reasons = s.reasons.length ? s.reasons.join(', ') : 'scheduled';
        return `<li class="schedule-item" data-task-id="${escapeAttr(s.task.id)}">
          <span class="schedule-rank">#${i + 1}</span>
          <div class="schedule-item-body">
            <span class="schedule-item-text">${escapeHtml(s.task.text)}</span>
            <span class="schedule-item-meta">${s.task.duration}m · ${s.task.effort} · ${reasons}</span>
            <div class="score-bar" style="--score:${scoreW}%"><span></span></div>
          </div>
        </li>`;
      })
      .join('');
  }

  if (explain) explain.textContent = explainSchedule(plan);
}

function renderForecast(forecast: DayForecast): void {
  const el = document.getElementById('forecast-panel');
  if (!el) return;

  const riskClass = forecast.riskOfOverload ? 'forecast-warn' : 'forecast-ok';
  const riskText = forecast.riskOfOverload ? 'Overload risk' : 'Capacity OK';
  const focus = forecast.focusTask ? escapeHtml(forecast.focusTask) : '—';

  el.innerHTML = [
    `<div class="forecast-item"><strong>${forecast.likelyCompleted}</strong> tasks likely today</div>`,
    `<div class="forecast-item">Focus: <strong>${focus}</strong></div>`,
    `<div class="forecast-item"><span class="${riskClass}">${riskText}</span></div>`,
  ].join('');
}

function renderInsights(recs: Recommendation[], behavioral: BehavioralInsight[]): void {
  const el = document.getElementById('insight-panel');
  if (!el) return;

  const items: string[] = [];

  for (const r of recs.slice(0, 2)) {
    items.push(
      `<p class="insight-line insight-rec"><span class="insight-icon">✦</span>${escapeHtml(r.headline)}</p>`,
    );
  }
  for (const b of behavioral.slice(0, 3)) {
    const cls =
      b.type === 'procrastination'
        ? 'insight-warn'
        : b.type === 'recommendation'
          ? 'insight-rec'
          : 'insight-info';
    items.push(
      `<p class="insight-line ${cls}"><span class="insight-icon">${iconFor(b.type)}</span>${escapeHtml(b.message)}</p>`,
    );
  }

  el.innerHTML =
    items.join('') ||
    '<p class="insight-line insight-info">Add tasks to get adaptive scheduling guidance.</p>';
}

function iconFor(type: BehavioralInsight['type']): string {
  switch (type) {
    case 'procrastination':
      return '⏳';
    case 'window':
      return '🕐';
    case 'completion':
      return '✓';
    default:
      return '→';
  }
}

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}

