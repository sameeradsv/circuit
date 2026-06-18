"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@shared/cortex";
import { energyDescriptor } from "@/lib/use-energy-level";
import { energySourceLabel, useEffectiveEnergy } from "@/lib/use-effective-energy";
import { useTheme } from "@/lib/use-theme";
import { useNotificationToggle } from "@/lib/use-notifications";

const NAV = [
  {
    href: "/", label: "Home", hint: "now",
    icon: (
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11L12 4l9 7v8a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
      </svg>
    ),
  },
  {
    href: "/add", label: "Add", hint: "",
    icon: (
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    ),
  },
  {
    href: "/tasks", label: "Tasks", hint: "",
    icon: (
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </svg>
    ),
  },
  {
    href: "/calendar", label: "Calendar", hint: "",
    icon: (
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 10h18" />
      </svg>
    ),
  },
  {
    href: "/analytics", label: "Analytics", hint: "",
    icon: (
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 20h18M8 17V9M12 17V3M16 17v-5" />
      </svg>
    ),
  },
  {
    href: "/energy", label: "Energy", hint: "",
    icon: (
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
  },
  {
    href: "/chat", label: "Chat", hint: "",
    icon: (
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

export function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { value: energy, source, loading: energyLoading } = useEffectiveEnergy();
  const { theme, setTheme } = useTheme();
  const { permission, enabled, toggle } = useNotificationToggle();
  const desc = energyDescriptor(energy);

  return (
    <aside className={"sidenav" + (open ? " is-open" : "")}>
      <Link href="/" className="brand" onClick={onClose}>
        <span className="dot-mark" />
        circuit
      </Link>

      <nav className="col gap-1" style={{ marginBottom: 24 }}>
        {NAV.map((n) => {
          const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={"navitem" + (active ? " is-active" : "")}
              onClick={onClose}
            >
              {n.icon}
              <span style={{ flex: 1 }}>{n.label}</span>
              {n.hint && <span className="nav-meta">{n.hint}</span>}
            </Link>
          );
        })}
      </nav>

      <div style={{ marginTop: "auto" }}>
        {/* Energy mini-card */}
        <div className="tiny muted" style={{ marginBottom: 8 }}>Currently</div>
        <div className="card-2" style={{ padding: 14 }}>
          <div className="between" style={{ marginBottom: 10 }}>
            <span className="display" style={{ fontSize: 28, fontWeight: 600 }}>
              {energyLoading ? "—" : energy}
              <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)", marginLeft: 2 }}>
                /10
              </span>
            </span>
            <span className="pill ghost" style={{ fontSize: 11 }}>{energyLoading ? "…" : desc.word}</span>
          </div>
          <div className="energy-rail" style={{ pointerEvents: "none" }}>
            <div className="track" style={{ width: `${((energy - 1) / 9) * 100}%` }} />
            <div className="knob" style={{ left: `${((energy - 1) / 9) * 100}%` }} />
          </div>
          {!energyLoading && (
            <p className="mono" style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 8 }}>
              {energySourceLabel(source)}
            </p>
          )}
        </div>

        {/* Palette toggle + user */}
        <div className="between" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
          <div className="row gap-3 aic">
            <button
              onClick={() => setTheme(theme === "paper" ? "ink" : "paper")}
              className="tiny muted"
              style={{ cursor: "pointer", background: "none", border: "none", padding: 0, fontFamily: "var(--font-body)" }}
              title={`Switch to ${theme === "paper" ? "ink" : "paper"} palette`}
            >
              {theme === "paper" ? "◐ ink" : "○ paper"}
            </button>
            <button
              onClick={toggle}
              className="tiny muted"
              style={{ cursor: permission === "denied" ? "not-allowed" : "pointer", background: "none", border: "none", padding: 0, opacity: permission === "denied" ? 0.4 : 1 }}
              title={
                permission === "denied"
                  ? "Notifications blocked — allow in browser settings"
                  : enabled
                  ? "Notifications on — click to disable"
                  : "Enable task reminders"
              }
            >
              {enabled ? (
                <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2zm6-6V11c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5S10.5 3.17 10.5 4v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
                </svg>
              ) : (
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
              )}
            </button>
          </div>
          {user && (
            <Link href="/account" className="tiny muted" style={{ textDecoration: "none" }} onClick={onClose}>
              {user.username}
            </Link>
          )}
        </div>
      </div>
    </aside>
  );
}
