"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiSummary } from "@/lib/api";
import { useAuth } from "@shared/cortex";
import { WorkloadBar } from "@/components/WorkloadBar";
import { BehavioralInsights } from "@/components/BehavioralInsights";
import { apiTaskToTask } from "@/lib/engine-adapter";
import { analyzeBehavior } from "@/engines/src/behavioral-engine";
import type { BehavioralInsight } from "@/engines/src/types/task";
import { useEnergyMode } from "@/lib/use-energy-mode";

export default function AnalyticsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mode] = useEnergyMode();
  const [summary, setSummary] = useState<ApiSummary | null>(null);
  const [insights, setInsights] = useState<BehavioralInsight[]>([]);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    setFetching(true);
    Promise.all([api.getSummary(), api.listTasks({ completed: false })])
      .then(([s, tasks]) => {
        setSummary(s);
        const engineTasks = tasks.map(apiTaskToTask);
        setInsights(analyzeBehavior(engineTasks, mode));
      })
      .catch(() => {})
      .finally(() => setFetching(false));
  }, [user, mode]);

  if (loading || !user) return null;

  const tags = summary ? Object.entries(summary.by_tag).sort((a, b) => b[1] - a[1]) : [];
  const totalHours = summary ? Math.round(summary.total_pending_minutes / 60 * 10) / 10 : 0;

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-medium text-circuit-text">Analytics</h1>

      {fetching && <p className="text-sm text-circuit-muted">Loading…</p>}

      {summary && (
        <>
          <WorkloadBar pendingMinutes={summary.total_pending_minutes} />

          {insights.length > 0 && (
            <section className="panel p-4">
              <BehavioralInsights insights={insights} />
            </section>
          )}

          {(summary.scheduling_insights?.length ?? 0) > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">Scheduling forecast</h2>
              <ul className="space-y-2">
                {summary.scheduling_insights!.map((ins, i) => (
                  <li key={i} className="panel px-4 py-3 flex items-start gap-3">
                    <span className="text-circuit-accent shrink-0">→</span>
                    <span className="text-sm text-circuit-muted">{ins.message}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Completion rate" value={`${Math.round(summary.completion_rate * 100)}%`} accent />
            <StatCard label="Pending tasks" value={String(summary.pending_tasks)} />
            <StatCard label="Pending time" value={`${totalHours}h`} />
            <StatCard label="Avg skips" value={summary.avg_skip_count.toFixed(1)} warn={summary.avg_skip_count > 1} />
          </div>

          {tags.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">Pending by tag</h2>
              <div className="space-y-2">
                {tags.map(([tag, count]) => {
                  const pct = summary.pending_tasks > 0 ? Math.round((count / summary.pending_tasks) * 100) : 0;
                  return (
                    <div key={tag} className="space-y-1">
                      <div className="flex justify-between text-xs text-circuit-muted">
                        <span className="capitalize">{tag}</span>
                        <span>{count} pending</span>
                      </div>
                      <div className="h-2 rounded-full bg-circuit-surface border border-circuit-border overflow-hidden">
                        <div className="h-full bg-circuit-accent/60 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {summary.attention_needed.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">Attention needed</h2>
              <ul className="space-y-2">
                {summary.attention_needed.map((ins) => (
                  <li key={ins.task_id} className="panel px-4 py-3 flex items-start gap-3">
                    <span className="text-amber-400 shrink-0">⚠</span>
                    <span className="text-sm text-circuit-muted">{ins.message}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {summary.most_skipped.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">Most skipped</h2>
              <ul className="space-y-2">
                {summary.most_skipped.map((t) => (
                  <li key={t.id} className="panel flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-circuit-text truncate">{t.text}</span>
                    <span className="ml-4 shrink-0 text-xs text-amber-400">skipped ×{t.skipped_count}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {summary.stale_tasks.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">
                Stale tasks <span className="text-circuit-muted font-normal normal-case">(open {'>'} 3 days)</span>
              </h2>
              <ul className="space-y-2">
                {summary.stale_tasks.map((t) => (
                  <li key={t.id} className="panel flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-circuit-text truncate">{t.text}</span>
                    <span className="ml-4 shrink-0 text-xs text-circuit-muted">{t.days_open}d old</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {summary.total_tasks === 0 && (
            <p className="text-sm text-circuit-muted">No tasks yet — add some to see analytics.</p>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="panel p-4">
      <p className="text-xs text-circuit-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${accent ? 'text-circuit-accent' : warn ? 'text-amber-400' : 'text-circuit-text'}`}>
        {value}
      </p>
    </div>
  );
}
