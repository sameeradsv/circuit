"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { useCircuitAuth } from "@/lib/use-circuit-auth";
import { api, ApiTask } from "@/lib/api";
import { useNotificationScheduler } from "@/lib/use-notifications";

const ICS_EXPIRES_KEY = "circuit-ics-expires";
const ICS_DISMISSED_KEY = "circuit-ics-expires-dismissed";
const WARN_DAYS = 60;

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
      const expiry = new Date(expiresAt).toLocaleDateString("en-US", { month: "long", year: "numeric" });
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
  const { user, loading } = useCircuitAuth();
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


  if (loading || !user) return null;

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-content">
        {banner && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 12, padding: "10px 16px", marginBottom: 16,
            background: banner.daysLeft <= 0 ? "var(--terra)" : "var(--mustard)",
            borderRadius: 8, fontSize: 13, flexWrap: "wrap",
          }}>
            <span style={{ color: "var(--ink)", flex: 1 }}>
              {banner.daysLeft <= 0
                ? `Your imported recurring calendar events have expired (${banner.expiry}). Re-import your .ics file to continue.`
                : `Recurring calendar events expire ${banner.daysLeft === 1 ? "tomorrow" : `in ${banner.daysLeft} days`} (${banner.expiry}). Re-import your .ics file on the Calendar page to extend.`}
            </span>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
              <button
                onClick={() => router.push("/calendar")}
                style={{ fontSize: 12, padding: "4px 10px", background: "var(--ink)", color: "var(--paper)", border: "none", borderRadius: 6, cursor: "pointer" }}
              >
                Go to Calendar
              </button>
              <button
                onClick={dismiss}
                style={{ fontSize: 12, background: "none", border: "none", cursor: "pointer", color: "var(--ink)", opacity: 0.6, padding: "4px 6px" }}
              >
                ✕
              </button>
            </div>
          </div>
        )}
        {children}
      </main>
      <TabBar />
    </div>
  );
}
