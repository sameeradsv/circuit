"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { PasskeyBanner } from "./PasskeyBanner";
import { useCircuitAuth } from "@/lib/use-circuit-auth";

const NO_SHELL_PATHS = ["/login"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useCircuitAuth();
  const bare = NO_SHELL_PATHS.includes(pathname);

  useEffect(() => {
    if (!bare && !loading && !user) {
      router.replace("/login");
    }
  }, [bare, loading, user, router]);

  if (bare) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        {children}
      </div>
    );
  }

  if (loading || !user) return null;

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-content">
        <PasskeyBanner />
        {children}
      </main>
      <TabBar />
    </div>
  );
}
