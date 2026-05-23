"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiTask } from "@/lib/api";
import { useCircuitAuth } from "@/lib/use-circuit-auth";
import { apiTaskToTask } from "@/lib/engine-adapter";
import { computeAnalytics } from "@/engines/src/analytics-engine";
import { detectProcrastination } from "@/engines/src/behavioral-engine/procrastination";

export default function AnalyticsPage() {
  const { user, loading } = useCircuitAuth();
  const router = useRouter();
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    setFetching(true);
    api.listTasks().then(setTasks).catch(() => {}).finally(() => setFetching(false));
  }, [user]);

  if (loading || !user) return null;

  const engineTasks = tasks.map(apiTaskToTask);
  const analytics = computeAnalytics(engineTasks);
  const procrastinationAlerts = detectProcrastination(engineTasks);

  const tags = Object.entries(analytics.byTag).sort((a, b) => b[1] - a[1]);
  const totalHours = Math.round(analytics.totalPendingMinutes / 60 * 10) / 10;

  const staleTasks = tasks.filter(
    (t) => !t.completed && Date.now() - new Date(t.created_at).getTime() > 3 * 24 * 60 * 60 * 1000
  );

  const mostSkipped = [...tasks]
    .filter((t) => !t.completed && (t.skipped_count ?? 0) > 0)
    .sort((a, b) => (b.skipped_count ?? 0) - (a.skipped_count ?? 0))
    .slice(0, 5);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-medium text-circuit-text">Analytics</h1>

      {fetching && <p className="text-sm text-circuit-muted">Loading…</p>}

      {/* Key stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Completion rate" value={`${Math.round(analytics.completionRate * 100)}%`} accent />
        <StatCard label="Pending tasks" value={String(analytics.pending)} />
        <StatCard label="Pending time" value={`${totalHours}h`} />
        <StatCard label="Avg skips" value={analytics.avgSkipCount.toFixed(1)} warn={analytics.avgSkipCount > 1} />
      </div>

      {/* By tag */}
      {tags.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">Pending by tag</h2>
          <div className="space-y-2">
            {tags.map(([tag, count]) => {
              const total = tasks.filter((t) => t.tag === tag).length;
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={tag} className="space-y-1">
                  <div className="flex justify-between text-xs text-circuit-muted">
                    <span className="capitalize">{tag}</span>
                    <span>{count} pending / {total} total</span>
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

      {/* Procrastination alerts */}
      {procrastinationAlerts.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">Attention needed</h2>
          <ul className="space-y-2">
            {procrastinationAlerts.map((ins, i) => (
              <li key={i} className="panel px-4 py-3 flex items-start gap-3">
                <span className="text-amber-400 shrink-0">⚠</span>
                <span className="text-sm text-circuit-muted">{ins.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Most skipped */}
      {mostSkipped.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">Most skipped</h2>
          <ul className="space-y-2">
            {mostSkipped.map((t) => (
              <li key={t.id} className="panel flex items-center justify-between px-4 py-3">
                <span className="text-sm text-circuit-text truncate">{t.text}</span>
                <span className="ml-4 shrink-0 text-xs text-amber-400">skipped ×{t.skipped_count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Stale tasks */}
      {staleTasks.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">
            Stale tasks <span className="text-circuit-muted font-normal normal-case">(open {'>'} 3 days)</span>
          </h2>
          <ul className="space-y-2">
            {staleTasks.map((t) => {
              const days = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000);
              return (
                <li key={t.id} className="panel flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-circuit-text truncate">{t.text}</span>
                  <span className="ml-4 shrink-0 text-xs text-circuit-muted">{days}d old</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!fetching && tasks.length === 0 && (
        <p className="text-sm text-circuit-muted">No tasks yet — add some to see analytics.</p>
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
