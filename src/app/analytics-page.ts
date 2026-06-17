import { analyzeBehavior } from "../behavioral-engine";
import { computeAnalytics } from "../analytics-engine";
import { computeSchedulingInsights } from "../analytics-engine/scheduling-insights";
import { getMode } from "./modes";
import type { Task } from "../types";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Render extended analytics — only called when user navigates to #analytics. */
export function renderAnalyticsPage(tasks: Task[]): void {
  const root = document.getElementById("analytics-root");
  if (!root) return;

  const mode = getMode();
  const analytics = computeAnalytics(tasks);
  const behavioral = analyzeBehavior(tasks, mode);
  const insights = computeSchedulingInsights(tasks);

  const tagRows = Object.entries(
    tasks.filter((t) => !t.completed).reduce<Record<string, number>>((acc, t) => {
      acc[t.tag] = (acc[t.tag] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => `<li><span class="cap">${escapeHtml(tag)}</span> <span class="muted">${count} pending</span></li>`)
    .join("");

  const insightHtml = insights.length
    ? insights.map((i) => `<li>${escapeHtml(i.message)}</li>`).join("")
    : "<li class=\"muted\">No scheduling warnings right now.</li>";

  const behavioralHtml = behavioral.length
    ? behavioral.map((b) => `<li>${escapeHtml(b.message)}</li>`).join("")
    : "<li class=\"muted\">No behavioral patterns flagged.</li>";

  root.innerHTML = `
    <header class="page-intro">
      <h2>Analytics</h2>
      <p class="muted">Local scheduling insights — no network calls.</p>
    </header>
    <div class="stats-grid analytics-stats">
      <div class="stat-card"><span class="stat-num">${analytics.pending}</span><span class="stat-lbl">Pending</span></div>
      <div class="stat-card"><span class="stat-num">${Math.round(analytics.completionRate * 100)}%</span><span class="stat-lbl">Complete</span></div>
      <div class="stat-card"><span class="stat-num">${analytics.totalPendingMinutes}m</span><span class="stat-lbl">Planned</span></div>
      <div class="stat-card"><span class="stat-num">${analytics.avgSkipCount.toFixed(1)}</span><span class="stat-lbl">Avg skips</span></div>
    </div>
    <section class="analytics-section">
      <h3>Scheduling forecast</h3>
      <ul class="insight-list">${insightHtml}</ul>
    </section>
    <section class="analytics-section">
      <h3>Behavioral insights</h3>
      <ul class="insight-list">${behavioralHtml}</ul>
    </section>
    ${tagRows ? `<section class="analytics-section"><h3>Pending by tag</h3><ul class="tag-list">${tagRows}</ul></section>` : ""}
  `;
}

/** Lightweight energy view — mode + capacity from local schedule (no event timeline). */
export function renderEnergyPage(tasks: Task[], workloadMinutes: number, capacityMinutes: number): void {
  const root = document.getElementById("energy-root");
  if (!root) return;

  const mode = getMode();
  const pct = Math.min(100, Math.round((workloadMinutes / capacityMinutes) * 100));
  const pending = tasks.filter((t) => !t.completed).length;

  root.innerHTML = `
    <header class="page-intro">
      <h2>Energy</h2>
      <p class="muted">Mode-aware capacity estimate. For cumulative task-event balance, use the full-stack app at <code>/energy</code> or Canopy → Energy for cross-app view.</p>
    </header>
    <div class="energy-mode-card">
      <span class="kicker">Current mode</span>
      <p class="energy-mode-label">${escapeHtml(mode)}</p>
    </div>
    <div class="workload-block" style="margin-top: 1rem">
      <div class="workload-label">${workloadMinutes} / ${capacityMinutes} min planned (${pct}%)</div>
      <div class="workload-bar"><div class="workload-fill${pct >= 100 ? " overload" : ""}" style="width:${pct}%"></div></div>
    </div>
    <p class="muted" style="margin-top:1rem;font-size:13px">${pending} open tasks — switch mode from the home dashboard to shift scoring weights.</p>
  `;
}
