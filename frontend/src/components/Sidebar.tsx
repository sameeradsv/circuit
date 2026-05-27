"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCircuitAuth } from "@/lib/use-circuit-auth";
import { useEnergyLevel, energyDescriptor } from "@/lib/use-energy-level";
import { useTheme } from "@/lib/use-theme";

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
    href: "/add", label: "Add", hint: "⌘N",
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
];

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useCircuitAuth();
  const [energy] = useEnergyLevel();
  const { theme, setTheme } = useTheme();
  const desc = energyDescriptor(energy);

  return (
    <aside className="sidenav">
      <Link href="/" className="brand">
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
              {energy}
              <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)", marginLeft: 2 }}>
                /10
              </span>
            </span>
            <span className="pill ghost" style={{ fontSize: 11 }}>{desc.word}</span>
          </div>
          <div className="energy-rail" style={{ pointerEvents: "none" }}>
            <div className="track" style={{ width: `${((energy - 1) / 9) * 100}%` }} />
            <div className="knob" style={{ left: `${((energy - 1) / 9) * 100}%` }} />
          </div>
        </div>

        {/* Palette toggle + user */}
        <div className="between" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
          <button
            onClick={() => setTheme(theme === "paper" ? "ink" : "paper")}
            className="tiny muted"
            style={{ cursor: "pointer", background: "none", border: "none", padding: 0, fontFamily: "var(--font-body)" }}
            title={`Switch to ${theme === "paper" ? "ink" : "paper"} palette`}
          >
            {theme === "paper" ? "◐ ink" : "○ paper"}
          </button>
          {user && (
            <Link href="/account" className="tiny muted" style={{ textDecoration: "none" }}>
              {user.username}
            </Link>
          )}
        </div>
      </div>
    </aside>
  );
}
