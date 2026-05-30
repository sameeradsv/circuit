"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { useCircuitAuth } from "@/lib/use-circuit-auth";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading } = useCircuitAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  // Forward Google OAuth result params to the calendar page.
  // The backend redirects to the root (/) because GitHub Pages only
  // reliably serves index.html, so we pick it up here and navigate.
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const imported = params.get("google_import");
    const err      = params.get("google_error");
    if (imported !== null || err !== null) {
      const qs = imported !== null ? `google_import=${imported}` : `google_error=${err}`;
      window.history.replaceState({}, "", window.location.pathname);
      router.push(`/calendar?${qs}`);
    }
  }, [user, router]);

  if (loading || !user) return null;

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-content">
        {children}
      </main>
      <TabBar />
    </div>
  );
}
