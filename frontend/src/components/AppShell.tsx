"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { PasskeyBanner } from "./PasskeyBanner";
import { useCircuitAuth } from "@/lib/use-circuit-auth";

const NO_SHELL_PATHS = ["/login"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useCircuitAuth();
  const bare = NO_SHELL_PATHS.includes(pathname);

  if (bare) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        {children}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-content">
        {user && <PasskeyBanner />}
        {children}
      </main>
      <TabBar />
    </div>
  );
}
