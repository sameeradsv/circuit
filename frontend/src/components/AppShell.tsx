"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { useCircuitAuth } from "@/lib/use-circuit-auth";
import { api, ApiTask } from "@/lib/api";
import { useNotificationScheduler } from "@/lib/use-notifications";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading } = useCircuitAuth();
  const [notifTasks, setNotifTasks] = useState<ApiTask[]>([]);
  useNotificationScheduler(notifTasks);

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
        {children}
      </main>
      <TabBar />
    </div>
  );
}
