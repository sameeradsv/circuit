"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, EnergyTimeline } from "@/lib/api";
import { useAuth } from "@shared/cortex";
import { todayIST } from "@/lib/tz";

function offsetDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export default function EnergyPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [date, setDate] = useState(todayIST);
  const [timeline, setTimeline] = useState<EnergyTimeline | null>(null);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    setFetching(true);
    api.getEnergyTimeline(date).then(setTimeline).catch(() => setTimeline(null)).finally(() => setFetching(false));
  }, [user, date]);

  if (loading || !user) return null;

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-circuit-text">Energy</h1>
          <p className="text-sm text-circuit-muted mt-1">
            Task-event balance for the day. For the combined Circuit + Canopy + Chef chart, open
            {" "}<span className="text-circuit-accent">Canopy → Energy</span> when sibling apps share Cortex auth.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn" onClick={() => setDate((d) => offsetDate(d, -1))}>‹</button>
          <span className="mono text-sm text-circuit-muted min-w-[7rem] text-center">{date}</span>
          <button type="button" className="btn" onClick={() => setDate((d) => offsetDate(d, 1))} disabled={date >= todayIST()}>›</button>
          {date !== todayIST() && (
            <button type="button" className="btn text-xs" onClick={() => setDate(todayIST())}>Today</button>
          )}
        </div>
      </div>

      {fetching && <p className="text-sm text-circuit-muted">Loading…</p>}

      {timeline && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="panel p-4">
              <p className="text-xs text-circuit-muted">Start</p>
              <p className="text-2xl font-semibold text-circuit-accent mt-1">{pct(timeline.start_energy)}</p>
            </div>
            <div className="panel p-4">
              <p className="text-xs text-circuit-muted">Now / close</p>
              <p className="text-2xl font-semibold text-circuit-text mt-1">{pct(timeline.end_energy)}</p>
            </div>
            <div className="panel p-4 col-span-2 sm:col-span-1">
              <p className="text-xs text-circuit-muted">Events</p>
              <p className="text-2xl font-semibold text-circuit-text mt-1">{timeline.events.length}</p>
            </div>
          </div>

          {timeline.events.length === 0 ? (
            <p className="text-sm text-circuit-muted">No task events on this day yet.</p>
          ) : (
            <ul className="space-y-2">
              {timeline.events.map((ev, i) => (
                <li key={`${ev.occurred_at}-${i}`} className="panel px-4 py-3 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-circuit-text">{ev.note}</p>
                    <p className="text-xs text-circuit-muted mt-1">{ev.time} · {ev.label}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {ev.delta != null && (
                      <p className={`text-xs mono ${ev.delta >= 0 ? "text-emerald-400" : "text-amber-400"}`}>
                        {ev.delta >= 0 ? "+" : ""}{pct(ev.delta)}
                      </p>
                    )}
                    {ev.running_energy != null && (
                      <p className="text-xs text-circuit-muted mt-0.5">→ {pct(ev.running_energy)}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
