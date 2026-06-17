"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { useAuth } from "@shared/cortex";
import { api, ApiTask } from "@/lib/api";
import { useNotificationScheduler } from "@/lib/use-notifications";

const ICS_EXPIRES_KEY = "circuit-ics-expires";
const ICS_DISMISSED_KEY = "circuit-ics-expires-dismissed";
const WARN_DAYS = 60;

function AuthBootScreen() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--paper)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.03em",
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "var(--ink)",
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "var(--terra)",
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          circuit
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--terra)",
                opacity: 0.55,
                animationDelay: `${i * 0.15}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function useIcsRenewalBanner() {
  const [banner, setBanner] = useState<{ daysLeft: number; expiry: string } | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(ICS_EXPIRES_KEY);
    const dismissed = localStorage.getItem(ICS_DISMISSED_KEY);
    if (!raw) return;
    const expiresAt = Number(raw);
    if (dismissed === raw) return;
    const daysLeft = Math.round((expiresAt - Date.now()) / 86_400_000);
    if (daysLeft <= WARN_DAYS) {
      const expiry = new Date(expiresAt).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
      setBanner({ daysLeft, expiry });
    }
  }, []);

  function dismiss() {
    const raw = localStorage.getItem(ICS_EXPIRES_KEY);
    if (raw) localStorage.setItem(ICS_DISMISSED_KEY, raw);
    setBanner(null);
  }

  return { banner, dismiss };
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [notifTasks, setNotifTasks] = useState<ApiTask[]>([]);
  useNotificationScheduler(notifTasks);
  const { banner, dismiss } = useIcsRenewalBanner();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    api.listTasks().then(setNotifTasks).catch(() => {});
  }, [user]);


  if (loading || !user) return <AuthBootScreen />;

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-content">
        {banner && (() => {
          const expired = banner.daysLeft <= 0;
          const fg = expired ? "white" : "rgba(0,0,0,0.85)";
          return (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 12, padding: "10px 16px", marginBottom: 16,
            background: expired ? "var(--terra)" : "var(--mustard)",
            borderRadius: 8, fontSize: 13, flexWrap: "wrap",
          }}>
            <span style={{ color: fg, flex: 1 }}>
              {expired
                ? `Your imported recurring calendar events have expired (${banner.expiry}). Re-import your .ics file to continue.`
                : `Recurring calendar events expire ${banner.daysLeft === 1 ? "tomorrow" : `in ${banner.daysLeft} days`} (${banner.expiry}). Re-import your .ics file on the Calendar page to extend.`}
            </span>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
              <button
                onClick={() => router.push("/calendar")}
                style={{ fontSize: 12, padding: "4px 10px", background: "rgba(0,0,0,0.15)", color: fg, border: "1px solid rgba(0,0,0,0.15)", borderRadius: 6, cursor: "pointer" }}
              >
                Go to Calendar
              </button>
              <button
                onClick={dismiss}
                style={{ fontSize: 12, background: "none", border: "none", cursor: "pointer", color: fg, opacity: 0.6, padding: "4px 6px" }}
              >
                ✕
              </button>
            </div>
          </div>
          );
        })()}
        {children}
      </main>
      <TabBar />
    </div>
  );
}
