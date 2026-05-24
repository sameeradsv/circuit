"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiTask } from "@/lib/api";
import { useCircuitAuth } from "@/lib/use-circuit-auth";
import { useEnergyMode } from "@/lib/use-energy-mode";
import { apiTaskToTask } from "@/lib/engine-adapter";
import { scoreTasks } from "@/engines/src/scheduling-engine/scoring";
import { detectProcrastination } from "@/engines/src/behavioral-engine/procrastination";
import { adaptiveRecommendations } from "@/engines/src/behavioral-engine/recommendations";
import { EnergyModeSwitcher } from "@/components/EnergyModeSwitcher";
import { WorkloadBar } from "@/components/WorkloadBar";
import { BehavioralInsights } from "@/components/BehavioralInsights";
import { formatSlot } from "@/lib/suggest-slot";

export default function DashboardPage() {
  const { user, loading } = useCircuitAuth();
  const [mode, setMode] = useEnergyMode();
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFetching(true);
    api.listTasks().then(setTasks).catch(() => {}).finally(() => setFetching(false));
  }, [user]);

  if (loading) return null;

  if (!user) {
    return (
      <div className="space-y-4 text-center animate-fade-in">
        <h1 className="text-3xl font-semibold text-circuit-text">Circuit</h1>
        <p className="text-circuit-muted">Adaptive task planning for focused work.</p>
        <Link href="/login" className="btn-primary inline-block">Get started</Link>
      </div>
    );
  }

  const engineTasks = tasks.map(apiTaskToTask);
  const now = Date.now();
  const ctx = {
    mode,
    now,
    availableMinutes: 480,
    completedToday: tasks.filter((t) => t.completed && new Date(t.updated_at).toDateString() === new Date().toDateString()).length,
  };

  const scored = scoreTasks(engineTasks, ctx);
  const pendingMinutes = tasks.filter((t) => !t.completed).reduce((s, t) => s + (t.duration ?? 30), 0);
  const insights = [
    ...detectProcrastination(engineTasks),
    ...adaptiveRecommendations(engineTasks, mode),
  ].slice(0, 4);

  const open = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);
  const highUrgency = open.filter((t) => t.urgency >= 0.7);
  const todayScheduled = open.filter((t) => {
    if (!t.scheduled_at) return false;
    const d = new Date(t.scheduled_at);
    return d.toDateString() === new Date().toDateString();
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 animate-fade-up">
        <h1 className="text-xl font-medium text-circuit-text">Hey, {user?.username}</h1>
        <EnergyModeSwitcher mode={mode} onChange={setMode} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Open tasks"   value={open.length}         delay={0} />
        <StatCard label="High urgency" value={highUrgency.length}  delay={1} accent />
        <StatCard label="Today"        value={todayScheduled.length} delay={2} />
        <StatCard label="Completed"    value={done.length}         delay={3} />
      </div>

      {fetching && <p className="text-sm text-circuit-muted animate-pulse">Loading…</p>}

      {/* Workload bar */}
      {open.length > 0 && (
        <div className="animate-fade-up-2">
          <WorkloadBar pendingMinutes={pendingMinutes} />
        </div>
      )}

      {/* Today's ranked plan */}
      {scored.length > 0 && (
        <section className="space-y-2 animate-fade-up-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">
              Today's plan <span className="normal-case font-normal text-xs">({mode} mode)</span>
            </h2>
            <Link href="/tasks" className="text-xs text-circuit-accent hover:underline">All tasks →</Link>
          </div>
          <ul className="space-y-2">
            {scored.slice(0, 6).map((s, i) => {
              const t = tasks.find((x) => String(x.id) === s.task.id);
              return (
                <li
                  key={s.task.id}
                  className="panel-lift flex items-center gap-3 px-4 py-3"
                  style={{ animationDelay: `${0.18 + i * 0.05}s` }}
                >
                  <span className="w-5 shrink-0 text-xs font-semibold text-circuit-accent">
                    #{i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-circuit-text truncate">{s.task.text}</p>
                    {s.reasons.length > 0 && (
                      <p className="mt-0.5 text-xs text-circuit-muted">{s.reasons.join(" · ")}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-xs text-circuit-accent font-medium">{Math.round(s.score)}</span>
                    {t?.scheduled_at && (
                      <span className="text-xs text-circuit-muted">{formatSlot(t.scheduled_at)}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Behavioural insights */}
      {insights.length > 0 && (
        <div className="panel p-4 animate-fade-up-4">
          <BehavioralInsights insights={insights} />
        </div>
      )}

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 animate-fade-up-4">
        <QuickLink href="/tasks"     label="Tasks"     desc="Add & manage" />
        <QuickLink href="/calendar"  label="Calendar"  desc="Day view" />
        <QuickLink href="/analytics" label="Analytics" desc="Patterns & stats" />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  delay = 0,
}: {
  label: string;
  value: number;
  accent?: boolean;
  delay?: number;
}) {
  const delayClass = ["animate-fade-up", "animate-fade-up-1", "animate-fade-up-2", "animate-fade-up-3"][delay] ?? "animate-fade-up";
  return (
    <div className={`panel p-4 ${delayClass}`}>
      <p className="text-xs text-circuit-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold animate-count-up ${accent ? "text-circuit-accent" : "text-circuit-text"}`}>
        {value}
      </p>
    </div>
  );
}

function QuickLink({ href, label, desc }: { href: string; label: string; desc: string }) {
  return (
    <Link href={href} className="panel-lift p-4 block">
      <p className="text-sm font-medium text-circuit-text">{label}</p>
      <p className="mt-0.5 text-xs text-circuit-muted">{desc}</p>
    </Link>
  );
}
