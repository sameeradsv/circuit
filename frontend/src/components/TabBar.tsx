"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useTheme } from "@/lib/use-theme";
import { useCircuitAuth } from "@/lib/use-circuit-auth";

const TABS = [
  { href: "/",         label: "Now",   glyph: "•" },
  { href: "/add",      label: "Add",   glyph: "+" },
  { href: "/tasks",    label: "Tasks", glyph: "≡" },
  { href: "/calendar", label: "Cal",   glyph: "▦" },
];

const MORE_LINKS = [
  { href: "/analytics", label: "Analytics", glyph: "↗" },
  { href: "/chat",      label: "Chat",      glyph: "◌" },
  { href: "/account",   label: "Account",   glyph: "○" },
];

export function TabBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { user } = useCircuitAuth();

  const moreActive = MORE_LINKS.some((l) => pathname.startsWith(l.href));

  return (
    <>
      <nav className="tabbar">
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} className={"tabitem" + (active ? " is-active" : "")}>
              <span className="tabglyph">{t.glyph}</span>
              <span>{t.label}</span>
            </Link>
          );
        })}
        <button
          className={"tabitem" + (open || moreActive ? " is-active" : "")}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="tabglyph">···</span>
          <span>More</span>
        </button>
      </nav>

      {/* Bottom sheet */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 90 }}
            onClick={() => setOpen(false)}
          />

          {/* Sheet */}
          <div style={{
            position: "fixed",
            bottom: "var(--content-bottom-inset)",
            left: 0, right: 0,
            zIndex: 91,
            background: "var(--paper)",
            borderTop: "1px solid var(--line)",
            borderRadius: "16px 16px 0 0",
            padding: "12px 0 8px",
            boxShadow: "0 -4px 24px rgba(0,0,0,0.12)",
            animation: "slide-up 180ms ease",
          }}>
            {/* Drag handle */}
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--line)", margin: "0 auto 16px" }} />

            {/* Nav links */}
            {MORE_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "13px 24px",
                  textDecoration: "none",
                  color: pathname.startsWith(l.href) ? "var(--ink)" : "var(--ink-2)",
                  background: pathname.startsWith(l.href) ? "var(--paper-2)" : "transparent",
                  fontFamily: "var(--font-body)",
                  fontSize: 15,
                }}
              >
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, width: 20, textAlign: "center", color: "var(--ink-3)" }}>
                  {l.glyph}
                </span>
                {l.label}
                {l.href === "/account" && user && (
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
                    {user.username}
                  </span>
                )}
              </Link>
            ))}

            {/* Divider */}
            <div style={{ height: 1, background: "var(--line)", margin: "8px 24px" }} />

            {/* Theme toggle */}
            <div style={{ display: "flex", alignItems: "center", padding: "12px 24px", gap: 14 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, width: 20, textAlign: "center", color: "var(--ink-3)" }}>◐</span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 15, color: "var(--ink-2)", flex: 1 }}>Theme</span>
              <div style={{ display: "flex", gap: 6 }}>
                {(["paper", "ink"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    style={{
                      padding: "5px 14px",
                      borderRadius: 20,
                      border: `1px solid ${theme === t ? "var(--ink)" : "var(--line)"}`,
                      background: theme === t ? "var(--ink)" : "transparent",
                      color: theme === t ? "var(--paper)" : "var(--ink-3)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      cursor: "pointer",
                      textTransform: "capitalize",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes slide-up {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </>
  );
}
