"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiTask } from "@/lib/api";
import { useCircuitAuth } from "@/lib/use-circuit-auth";

export default function DashboardPage() {
  const { user, loading } = useCircuitAuth();
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFetching(true);
    api
      .listTasks()
      .then(setTasks)
      .catch(() => {})
      .finally(() => setFetching(false));
  }, [user]);

  if (loading) return null;

  if (!user) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-3xl font-semibold text-circuit-text">Circuit</h1>
        <p className="text-circuit-muted">Adaptive task planning for focused work.</p>
        <Link href="/login" className="btn-primary inline-block">
          Get started
        </Link>
      </div>
    );
  }

  const open = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);
  const highUrgency = open.filter((t) => t.urgency >= 0.7);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-medium text-circuit-text">
        Hey, {user?.username}
      </h1>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Open tasks" value={open.length} />
        <StatCard label="High urgency" value={highUrgency.length} accent />
        <StatCard label="Completed" value={done.length} />
      </div>

      {fetching && (
        <p className="text-sm text-circuit-muted">Loading tasks…</p>
      )}

      {!fetching && open.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">
            Top priority
          </h2>
          <ul className="space-y-2">
            {[...open]
              .sort((a, b) => b.urgency - a.urgency)
              .slice(0, 5)
              .map((t) => (
                <li
                  key={t.id}
                  className="panel flex items-center justify-between px-4 py-3"
                >
                  <span className="text-sm text-circuit-text">{t.text}</span>
                  <span className="text-xs text-circuit-muted capitalize">{t.tag}</span>
                </li>
              ))}
          </ul>
          <Link href="/tasks" className="text-xs text-circuit-accent hover:underline">
            View all tasks →
          </Link>
        </section>
      )}

      {!fetching && tasks.length === 0 && (
        <div className="panel p-6 text-center">
          <p className="text-circuit-muted text-sm">No tasks yet.</p>
          <Link href="/tasks" className="mt-3 inline-block text-xs text-circuit-accent hover:underline">
            Add your first task →
          </Link>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="panel p-4">
      <p className="text-xs text-circuit-muted">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${
          accent ? "text-circuit-accent" : "text-circuit-text"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
