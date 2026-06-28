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

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function energyTone(value: number): { fill: string; text: string; label: string } {
  if (value < 0.25) return { fill: "var(--terra)", text: "text-circuit-accent", label: "Low" };
  if (value < 0.55) return { fill: "var(--mustard)", text: "text-amber-500", label: "Limited" };
  if (value < 0.8) return { fill: "var(--sage)", text: "text-circuit-accent2", label: "Steady" };
  return { fill: "#2f8f5b", text: "text-emerald-600", label: "Full" };
}

function BatteryGauge({
  value,
  label,
  size = "lg",
}: {
  value: number;
  label?: string;
  size?: "sm" | "lg";
}) {
  const level = clamp01(value);
  const tone = energyTone(level);
  const height = size === "lg" ? "h-12" : "h-7";
  const width = size === "lg" ? "w-full max-w-[15rem]" : "w-20";
  const capHeight = size === "lg" ? "h-5" : "h-3";

  return (
    <div className={size === "lg" ? "space-y-2" : "flex items-center justify-end gap-2"}>
      {label && <p className="text-xs text-circuit-muted">{label}</p>}
      <div className={`flex items-center gap-1.5 ${size === "lg" ? "" : "shrink-0"}`} aria-label={`${Math.round(level * 100)}% energy`}>
        <div className={`relative ${height} ${width} rounded-md border border-circuit-border bg-paper overflow-hidden`}>
          <div
            className="absolute inset-y-0 left-0 rounded-[5px] transition-[width]"
            style={{ width: `${level * 100}%`, backgroundColor: tone.fill }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`mono text-sm font-semibold ${tone.text}`}>{Math.round(level * 100)}%</span>
          </div>
        </div>
        <div className={`${capHeight} w-1.5 rounded-r-sm border border-l-0 border-circuit-border bg-paper-2`} />
      </div>
      {size === "lg" && <p className={`text-xs font-medium ${tone.text}`}>{tone.label}</p>}
    </div>
  );
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
            {" "}<span className="text-circuit-accent">Canopy -&gt; Energy</span> when sibling apps share Cortex auth.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn" onClick={() => setDate((d) => offsetDate(d, -1))}>{"<"}</button>
          <span className="text-sm text-circuit-muted min-w-[8rem] text-center">{fmtDate(date)}</span>
          <button type="button" className="btn" onClick={() => setDate((d) => offsetDate(d, 1))} disabled={date >= todayIST()}>{">"}</button>
          {date !== todayIST() && (
            <button type="button" className="btn text-xs" onClick={() => setDate(todayIST())}>Today</button>
          )}
        </div>
      </div>

      {fetching && <p className="text-sm text-circuit-muted">Loading...</p>}

      {timeline && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="panel p-4">
              <BatteryGauge value={timeline.start_energy} label="Start" />
            </div>
            <div className="panel p-4">
              <BatteryGauge value={timeline.end_energy} label="Now / close" />
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
                    <p className="text-xs text-circuit-muted mt-1">{ev.time} - {ev.label}</p>
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    {ev.delta != null && (
                      <p className={`text-xs mono ${ev.delta >= 0 ? "text-emerald-400" : "text-amber-400"}`}>
                        {ev.delta >= 0 ? "+" : ""}{pct(ev.delta)}
                      </p>
                    )}
                    {ev.running_energy != null && (
                      <BatteryGauge value={ev.running_energy} size="sm" />
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
