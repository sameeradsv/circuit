"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiBlackout, ApiSettings, ApiSleepLog, ApiUserState } from "@/lib/api";
import { useAuth } from "@shared/cortex";
import { usePasskey } from "@/lib/usePasskey";
import { dateStrToISTEndMs, dateStrToISTMs, fmtDateIST, todayIST } from "@/lib/tz";
import { invalidateTaskCache } from "@/lib/task-cache";
import { useCombinedEnergy } from "@/lib/use-combined-energy";
import { canopyPresetZeroOne, notifyUserStateUpdated } from "@/lib/use-effective-energy";
import { discoverVanillaTaskStores, vanillaTasksFromKey } from "@/lib/vanilla-migrate";

const ENERGY_MODES = ["normal", "deep", "low", "social"] as const;

function addDaysDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtSleepTime(ms: number | null): string {
  if (ms == null) return "—";
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AccountPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  const [settings, setSettings] = useState<ApiSettings | null>(null);
  const [state, setState] = useState<ApiUserState | null>(null);
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // export/import state
  const [exportPass, setExportPass] = useState("");
  const [importPass, setImportPass] = useState("");
  const [importBlob, setImportBlob] = useState("");
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  // vanilla PWA localStorage migration
  const [vanillaStores, setVanillaStores] = useState<{ key: string; count: number }[]>([]);
  const [migratingKey, setMigratingKey] = useState<string | null>(null);
  const [migrateResult, setMigrateResult] = useState<string | null>(null);
  const [migrateErr, setMigrateErr] = useState<string | null>(null);

  // sleep overrides (timing comes from the "Sleep" calendar task)
  const [todaySleep, setTodaySleep] = useState<ApiSleepLog | null>(null);
  const [sleepQuality, setSleepQuality] = useState<number | "">("");
  const [sleepDisturbed, setSleepDisturbed] = useState(false);
  const [sleepNotes, setSleepNotes] = useState("");
  const [sleepSaving, setSleepSaving] = useState(false);
  const [sleepMsg, setSleepMsg] = useState<string | null>(null);
  const [sleepErr, setSleepErr] = useState<string | null>(null);
  const [showSleepHistory, setShowSleepHistory] = useState(false);
  const [sleepOverrides, setSleepOverrides] = useState<ApiSleepLog[]>([]);
  const [sleepOverridePage, setSleepOverridePage] = useState(1);
  const [sleepOverridePages, setSleepOverridePages] = useState(0);
  const [sleepOverrideTotal, setSleepOverrideTotal] = useState(0);
  const [sleepHistoryLoading, setSleepHistoryLoading] = useState(false);
  const [editingSleepDate, setEditingSleepDate] = useState<string | null>(null);
  const SLEEP_OVERRIDE_PAGE_SIZE = 10;

  // blackout state
  const [blackouts, setBlackouts] = useState<ApiBlackout[]>([]);
  const [newBlackoutType, setNewBlackoutType] = useState("travelling");
  const today = new Date().toISOString().slice(0, 10);
  const [newBlackoutStart, setNewBlackoutStart] = useState(today);
  const [newBlackoutEnd, setNewBlackoutEnd] = useState(today);
  const [addingBlackout, setAddingBlackout] = useState(false);
  const [blackoutMsg, setBlackoutMsg] = useState<string | null>(null);
  const [blackoutErr, setBlackoutErr] = useState<string | null>(null);
  const [showBlackoutList, setShowBlackoutList] = useState(false);
  const [blackoutListPage, setBlackoutListPage] = useState(1);
  const [editingBlackoutId, setEditingBlackoutId] = useState<number | null>(null);
  const [editBlackoutType, setEditBlackoutType] = useState("travelling");
  const [editBlackoutStart, setEditBlackoutStart] = useState(today);
  const [editBlackoutEnd, setEditBlackoutEnd] = useState(today);
  const [savingBlackout, setSavingBlackout] = useState(false);
  const BLACKOUT_PAGE_SIZE = 5;
  const { energy: combinedEnergy } = useCombinedEnergy();
  const canopyPreset = canopyPresetZeroOne(combinedEnergy);
  const [energyManualOverride, setEnergyManualOverride] = useState(false);

  // cleanup state
  const sixMonthsAhead = new Date();
  sixMonthsAhead.setMonth(sixMonthsAhead.getMonth() + 6);
  const [cleanupAfterDate, setCleanupAfterDate] = useState(sixMonthsAhead.toISOString().slice(0, 10));
  const [cleanupConfirm, setCleanupConfirm] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupMsg, setCleanupMsg] = useState<string | null>(null);
  const [cleanupErr, setCleanupErr] = useState<string | null>(null);

  async function handleCleanup() {
    setCleaning(true);
    setCleanupErr(null);
    setCleanupMsg(null);
    try {
      const afterMs = new Date(cleanupAfterDate).getTime();
      const { deleted } = await api.cleanupTasks({ afterMs });
      setCleanupMsg(`Deleted ${deleted} future event${deleted !== 1 ? "s" : ""}.`);
      setCleanupConfirm(false);
    } catch (e) {
      setCleanupErr(e instanceof Error ? e.message : "Cleanup failed");
    } finally {
      setCleaning(false);
    }
  }

  // danger zone
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { supported: passkeySupported, registered: passkeyRegistered, registerPasskey } = usePasskey();
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyErr, setPasskeyErr] = useState<string | null>(null);

  async function handleEnablePasskey() {
    setPasskeyBusy(true);
    setPasskeyErr(null);
    try {
      await registerPasskey();
    } catch (e) {
      setPasskeyErr(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setPasskeyBusy(false);
    }
  }

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    setVanillaStores(discoverVanillaTaskStores());
  }, [user]);

  async function loadSleepOverrides(page: number) {
    setSleepHistoryLoading(true);
    try {
      const data = await api.listSleepOverrides(page, SLEEP_OVERRIDE_PAGE_SIZE);
      setSleepOverrides(data.items);
      setSleepOverridePage(data.page);
      setSleepOverridePages(data.pages);
      setSleepOverrideTotal(data.total);
    } catch {
      setSleepOverrides([]);
      setSleepOverrideTotal(0);
      setSleepOverridePages(0);
    } finally {
      setSleepHistoryLoading(false);
    }
  }

  async function toggleSleepHistory() {
    if (showSleepHistory) {
      setShowSleepHistory(false);
      return;
    }
    setShowSleepHistory(true);
    await loadSleepOverrides(1);
  }

  function applySleepFormFromLog(log: ApiSleepLog | null) {
    if (log) {
      setSleepQuality(log.quality != null && !log.quality_is_default ? log.quality : "");
      setSleepDisturbed(!!log.disturbed);
      setSleepNotes(log.notes ?? "");
    } else {
      setSleepQuality("");
      setSleepDisturbed(false);
      setSleepNotes("");
    }
  }

  function beginEditSleepOverride(log: ApiSleepLog) {
    setEditingSleepDate(log.date);
    applySleepFormFromLog(log);
    setSleepMsg(null);
    setSleepErr(null);
  }

  function cancelEditSleepOverride() {
    setEditingSleepDate(null);
    applySleepFormFromLog(todaySleep);
    setSleepMsg(null);
    setSleepErr(null);
  }

  async function handleDeleteSleepOverride(log: ApiSleepLog) {
    if (!confirm(`Remove sleep overrides for ${log.date}?`)) return;
    setSleepErr(null);
    setSleepMsg(null);
    try {
      await api.deleteSleepOverride(log.date);
      if (editingSleepDate === log.date) cancelEditSleepOverride();
      if (log.date === todayIST()) {
        const factor = await api.getSleepFactor();
        setTodaySleep(factor.sleep_log);
        if (!editingSleepDate) applySleepFormFromLog(factor.sleep_log);
      }
      if (showSleepHistory) {
        const nextPage =
          sleepOverrides.length === 1 && sleepOverridePage > 1
            ? sleepOverridePage - 1
            : sleepOverridePage;
        await loadSleepOverrides(nextPage);
      }
      api.listSleepOverrides(1, 1)
        .then((d) => setSleepOverrideTotal(d.total))
        .catch(() => {});
      setSleepMsg(`Removed overrides for ${log.date}.`);
    } catch (e) {
      setSleepErr(e instanceof Error ? e.message : "Failed to delete sleep override");
    }
  }

  useEffect(() => {
    if (!user) return;
    setPrefsLoading(true);
    Promise.all([api.getSettings(), api.getUserState(), api.listBlackouts(), api.getSleepFactor()])
      .then(([s, st, bl, factor]) => {
        setSettings(s);
        setState(st);
        setBlackouts(bl);
        const today = factor.sleep_log;
        setTodaySleep(today);
        if (!editingSleepDate) applySleepFormFromLog(today);
      })
      .catch(() => {})
      .finally(() => setPrefsLoading(false));
    api.listSleepOverrides(1, 1)
      .then((d) => setSleepOverrideTotal(d.total))
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    if (state) setEnergyManualOverride(state.energy_manual_override ?? false);
  }, [state]);

  async function handleAddBlackout() {
    if (!newBlackoutStart || !newBlackoutEnd) return;
    setAddingBlackout(true);
    setBlackoutErr(null);
    setBlackoutMsg(null);
    try {
      const startMs = dateStrToISTMs(newBlackoutStart);
      const endMs = dateStrToISTEndMs(newBlackoutEnd);
      const b = await api.createBlackout({ blackout_type: newBlackoutType, start_date_ms: startMs, end_date_ms: endMs });
      setBlackouts((prev) => [...prev, b].sort((a, b) => a.start_date_ms - b.start_date_ms));
      invalidateTaskCache();
      const moved = b.tasks_rescheduled ?? 0;
      setBlackoutMsg(
        moved > 0
          ? `Blackout added. ${moved} scheduled task${moved !== 1 ? "s" : ""} moved out of the range.`
          : "Blackout added.",
      );
    } catch (e) {
      setBlackoutErr(e instanceof Error ? e.message : "Failed to add blackout");
    } finally {
      setAddingBlackout(false);
    }
  }

  function handleNewBlackoutType(value: string) {
    setNewBlackoutType(value);
    setBlackoutMsg(null);
    if (value === "period" && newBlackoutStart) {
      setNewBlackoutEnd(addDaysDateStr(newBlackoutStart, 5));
    }
  }

  function handleNewBlackoutStart(value: string) {
    setNewBlackoutStart(value);
    setBlackoutMsg(null);
    if (newBlackoutType === "period" && value) {
      setNewBlackoutEnd(addDaysDateStr(value, 5));
    }
  }

  async function handleDeleteBlackout(id: number) {
    try {
      await api.deleteBlackout(id);
      setBlackouts((prev) => prev.filter((b) => b.id !== id));
      if (editingBlackoutId === id) setEditingBlackoutId(null);
    } catch (e) {
      setBlackoutErr(e instanceof Error ? e.message : "Failed to remove blackout");
    }
  }

  function startEditBlackout(b: ApiBlackout) {
    setEditingBlackoutId(b.id);
    setEditBlackoutType(b.blackout_type);
    const startStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(b.start_date_ms));
    const endStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(b.end_date_ms));
    setEditBlackoutStart(startStr);
    setEditBlackoutEnd(endStr);
    setBlackoutErr(null);
    setBlackoutMsg(null);
  }

  async function handleSaveBlackout(id: number) {
    if (!editBlackoutStart || !editBlackoutEnd) return;
    setSavingBlackout(true);
    setBlackoutErr(null);
    try {
      const updated = await api.updateBlackout(id, {
        blackout_type: editBlackoutType,
        start_date_ms: dateStrToISTMs(editBlackoutStart),
        end_date_ms: dateStrToISTEndMs(editBlackoutEnd),
      });
      setBlackouts((prev) => prev.map((b) => b.id === id ? updated : b).sort((a, b) => a.start_date_ms - b.start_date_ms));
      setEditingBlackoutId(null);
      setBlackoutMsg("Blackout updated.");
    } catch (e) {
      setBlackoutErr(e instanceof Error ? e.message : "Failed to update blackout");
    } finally {
      setSavingBlackout(false);
    }
  }

  if (loading || !user) return null;

  const vals = settings?.values ?? {};
  const prefsFormKey = settings && state
    ? JSON.stringify({ values: settings.values, state, canopy: Math.round(canopyPreset * 1000) })
    : null;

  async function savePreferences(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setSaving(true);
    setSaveMsg(null);
    try {
      const newSettings = await api.updateSettings({
        default_energy_mode: data.get("default_energy_mode") as string,
        working_hours_start: Number(data.get("working_hours_start")),
        working_hours_end: Number(data.get("working_hours_end")),
        daily_capacity_minutes: Number(data.get("daily_capacity_minutes")),
        default_sleep_quality: Number(data.get("default_sleep_quality")),
        default_bedtime: data.get("default_bedtime") as string,
        default_wake_time: data.get("default_wake_time") as string,
      });
      const manualOverride = energyManualOverride;
      const newState = await api.setUserState({
        energy_level: manualOverride
          ? Number(data.get("energy_level"))
          : canopyPresetZeroOne(combinedEnergy),
        energy_manual_override: manualOverride,
        stress_level: Number(data.get("stress_level")),
        time_available_minutes: Number(data.get("time_available_minutes")),
        focus_mode: data.get("focus_mode") as string,
      });
      setSettings(newSettings);
      setState(newState);
      setEnergyManualOverride(manualOverride);
      notifyUserStateUpdated();
      setSaveMsg("Saved.");
    } catch {
      setSaveMsg("Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleExport(e: FormEvent) {
    e.preventDefault();
    setExportErr(null);
    setExportResult(null);
    setExporting(true);
    try {
      const blob = await api.exportData(exportPass);
      const json = JSON.stringify(blob, null, 2);
      setExportResult(json);
      // Trigger download
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      a.download = `circuit-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
    } catch (err) {
      setExportErr(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function handleImport(e: FormEvent) {
    e.preventDefault();
    setImportErr(null);
    setImportResult(null);
    setImporting(true);
    try {
      const blob = JSON.parse(importBlob);
      const result = await api.importData(importPass, blob);
      setImportResult(`Imported ${result.tasks_created} tasks (${result.tasks_skipped} skipped).`);
    } catch (err) {
      setImportErr(err instanceof Error ? err.message : "Import failed. Check passphrase and file.");
    } finally {
      setImporting(false);
    }
  }

  async function handleVanillaMigrate(key: string) {
    setMigrateErr(null);
    setMigrateResult(null);
    setMigratingKey(key);
    try {
      const payload = vanillaTasksFromKey(key);
      const result = await api.migrateTasks(payload);
      setMigrateResult(`Migrated ${result.created} tasks (${result.skipped} already on account).`);
      invalidateTaskCache();
      setVanillaStores(discoverVanillaTaskStores());
    } catch (err) {
      setMigrateErr(err instanceof Error ? err.message : "Migration failed");
    } finally {
      setMigratingKey(null);
    }
  }

  async function handleLogSleep() {
    setSleepSaving(true);
    setSleepErr(null);
    setSleepMsg(null);
    try {
      const targetDate = editingSleepDate ?? undefined;
      const log = await api.logSleep({
        date: targetDate,
        quality: sleepQuality !== "" ? sleepQuality : null,
        disturbed: sleepDisturbed,
        notes: sleepNotes.trim() || null,
      });
      if (!targetDate || targetDate === todayIST()) {
        setTodaySleep(log);
        applySleepFormFromLog(log);
      } else {
        applySleepFormFromLog(todaySleep);
      }
      setEditingSleepDate(null);
      if (showSleepHistory) await loadSleepOverrides(sleepOverridePage);
      api.listSleepOverrides(1, 1)
        .then((d) => setSleepOverrideTotal(d.total))
        .catch(() => {});
      const dateLabel = targetDate && targetDate !== todayIST() ? ` for ${targetDate}` : "";
      const durLabel = log.duration_h ? ` (${log.duration_h.toFixed(1)}h from Sleep task)` : "";
      setSleepMsg(`Saved overrides${dateLabel}${durLabel}.`);
    } catch (e) {
      setSleepErr(e instanceof Error ? e.message : "Failed to save sleep overrides");
    } finally {
      setSleepSaving(false);
    }
  }

  async function handleDeleteData() {
    setDeleting(true);
    try {
      await api.deleteUserData();
      setConfirmDelete(false);
      router.push("/");
    } catch {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-10 max-w-2xl">
      <div>
        <h1 className="text-xl font-medium text-circuit-text">Account</h1>
        <p className="mt-1 text-sm text-circuit-muted">
          {user.username}
          <button
            onClick={logout}
            className="ml-4 text-xs text-circuit-muted hover:text-circuit-text transition-colors"
          >
            Sign out
          </button>
        </p>
      </div>

      {/* Preferences */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">Preferences</h2>
        {prefsLoading || !prefsFormKey ? (
          <div className="panel p-5 text-sm text-circuit-muted">Loading preferences…</div>
        ) : (
        <form key={prefsFormKey} onSubmit={savePreferences} className="panel p-5 space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-circuit-muted">Default energy mode</span>
              <select name="default_energy_mode" defaultValue={String(vals.default_energy_mode ?? "normal")} className="input-field w-full">
                {ENERGY_MODES.map((m) => (
                  <option key={m} value={m} className="bg-circuit-bg capitalize">{m}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-circuit-muted">Daily capacity (min)</span>
              <input
                type="number" name="daily_capacity_minutes" min={30} max={960} step={30}
                defaultValue={Number(vals.daily_capacity_minutes ?? 480)}
                className="input-field"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-circuit-muted">Work starts (hour)</span>
              <input
                type="number" name="working_hours_start" min={0} max={23}
                defaultValue={Number(vals.working_hours_start ?? 9)}
                className="input-field"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-circuit-muted">Work ends (hour)</span>
              <input
                type="number" name="working_hours_end" min={1} max={24}
                defaultValue={Number(vals.working_hours_end ?? 18)}
                className="input-field"
              />
            </label>
            <label className="space-y-1 col-span-2 sm:col-span-1">
              <span className="text-xs text-circuit-muted">Default sleep quality (0–10)</span>
              <input
                type="number" name="default_sleep_quality" min={0} max={10} step={1}
                defaultValue={Number(vals.default_sleep_quality ?? 7)}
                className="input-field"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-circuit-muted">Default bedtime</span>
              <input
                type="time" name="default_bedtime"
                defaultValue={String(vals.default_bedtime ?? "23:00")}
                className="input-field w-full"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-circuit-muted">Default wake time</span>
              <input
                type="time" name="default_wake_time"
                defaultValue={String(vals.default_wake_time ?? "07:00")}
                className="input-field w-full"
              />
            </label>
          </div>

          <hr className="border-circuit-border" />
          <p className="text-xs font-medium text-circuit-muted uppercase tracking-wider">Today&apos;s context</p>
          <div className="rounded border border-circuit-border px-3 py-2 text-xs text-circuit-muted">
            Default energy from Canopy:{" "}
            <span className="text-circuit-text font-medium">{Math.round(canopyPreset * 100)}%</span>
            {!combinedEnergy?.canopy && combinedEnergy && (
              <span> (Canopy unavailable — using Circuit {Math.round(combinedEnergy.circuit * 100)}%)</span>
            )}
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="energy_manual_override"
              checked={energyManualOverride}
              onChange={(e) => setEnergyManualOverride(e.target.checked)}
              className="accent-circuit-accent"
            />
            <span className="text-xs text-circuit-muted">Override with manual energy level</span>
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className={`space-y-1 ${energyManualOverride ? "" : "opacity-50"}`}>
              <span className="text-xs text-circuit-muted">
                Energy level {energyManualOverride && state ? `${Math.round(state.energy_level * 100)}%` : `${Math.round(canopyPreset * 100)}%`}
              </span>
              <input
                type="range" name="energy_level" min={0} max={1} step={0.05}
                defaultValue={energyManualOverride ? (state?.energy_level ?? canopyPreset) : canopyPreset}
                disabled={!energyManualOverride}
                className="w-full accent-circuit-accent disabled:cursor-not-allowed"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-circuit-muted">
                Stress level {state ? `${Math.round(state.stress_level * 100)}%` : ""}
              </span>
              <input
                type="range" name="stress_level" min={0} max={1} step={0.05}
                defaultValue={state?.stress_level ?? 0.3}
                className="w-full accent-circuit-accent"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-circuit-muted">Time available today (min)</span>
              <input
                type="number" name="time_available_minutes" min={0} max={1440} step={15}
                defaultValue={state?.time_available_minutes ?? 480}
                className="input-field"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-circuit-muted">Current focus mode</span>
              <select name="focus_mode" defaultValue={state?.focus_mode ?? "normal"} className="input-field w-full">
                {ENERGY_MODES.map((m) => (
                  <option key={m} value={m} className="bg-circuit-bg capitalize">{m}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-center gap-4">
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? "Saving…" : "Save preferences"}
            </button>
            {saveMsg && <span className="text-xs text-circuit-muted">{saveMsg}</span>}
          </div>
        </form>
        )}
      </section>

      {/* Blackouts */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">Blackouts</h2>
        <div className="panel p-5 space-y-4">
          <p className="text-xs text-circuit-muted">
            Mark dates when you&apos;re unavailable. Flagged tasks are hidden in your task list during blackouts;
            adding a blackout also moves affected scheduled tasks to their post-blackout slot. Shaded days appear on the calendar.
          </p>

          <div className="flex flex-wrap gap-3 items-end">
            <label className="space-y-1">
              <span className="text-xs text-circuit-muted">Type</span>
              <select
                value={newBlackoutType}
                onChange={(e) => handleNewBlackoutType(e.target.value)}
                className="input-field"
              >
                <option value="travelling">Travelling</option>
                <option value="period">Period</option>
                <option value="sickness">Sickness</option>
                <option value="leave">On leave</option>
                <option value="wfh">Working from home</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-circuit-muted">From</span>
              <input
                type="date"
                value={newBlackoutStart}
                onChange={(e) => handleNewBlackoutStart(e.target.value)}
                className="input-field"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-circuit-muted">To</span>
              <input
                type="date"
                value={newBlackoutEnd}
                onChange={(e) => { setNewBlackoutEnd(e.target.value); setBlackoutMsg(null); }}
                className="input-field"
              />
            </label>
            <button
              onClick={handleAddBlackout}
              disabled={addingBlackout || !newBlackoutStart || !newBlackoutEnd}
              className="btn btn-primary"
            >
              {addingBlackout ? "Adding…" : "Add"}
            </button>
          </div>

          {blackoutErr && <p className="text-sm text-red-400">{blackoutErr}</p>}
          {blackoutMsg && <p className="text-xs text-circuit-muted">{blackoutMsg}</p>}

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => { setShowBlackoutList((v) => !v); setBlackoutListPage(1); }}
              className="btn text-xs"
              style={{ background: "transparent", border: "1px solid var(--circuit-border, var(--line))" }}
            >
              {showBlackoutList ? "Hide blackout history" : "Show blackout history"}
              {!showBlackoutList && blackouts.length > 0 ? ` (${blackouts.length})` : ""}
            </button>
          </div>

          {showBlackoutList && (
            <div className="space-y-2 pt-1 border-t border-circuit-border">
              {blackouts.length === 0 ? (
                <p className="text-xs text-circuit-muted pt-2">No blackouts saved yet.</p>
              ) : (
                <>
                  <p className="text-xs text-circuit-muted pt-2">
                    Saved blackouts · {blackouts.length} total
                  </p>
                  {blackouts.slice((blackoutListPage - 1) * BLACKOUT_PAGE_SIZE, blackoutListPage * BLACKOUT_PAGE_SIZE).map((b) => {
                    const start = fmtDateIST(b.start_date_ms, { month: "short", day: "numeric", year: "numeric" });
                    const end = fmtDateIST(b.end_date_ms, { month: "short", day: "numeric", year: "numeric" });
                    const label = b.blackout_type.charAt(0).toUpperCase() + b.blackout_type.slice(1);
                    const isEditing = editingBlackoutId === b.id;
                    return (
                      <div key={b.id} className={`text-xs py-2 border-b border-circuit-border last:border-0 space-y-2 ${isEditing ? "bg-circuit-accent/5 -mx-1 px-1 rounded" : ""}`}>
                        {isEditing ? (
                          <div className="space-y-2">
                            <div className="flex flex-wrap gap-2 items-end">
                              <select
                                value={editBlackoutType}
                                onChange={(e) => setEditBlackoutType(e.target.value)}
                                className="input-field text-xs"
                              >
                                <option value="travelling">Travelling</option>
                                <option value="period">Period</option>
                                <option value="sickness">Sickness</option>
                                <option value="leave">On leave</option>
                                <option value="wfh">Working from home</option>
                              </select>
                              <input type="date" value={editBlackoutStart} onChange={(e) => setEditBlackoutStart(e.target.value)} className="input-field text-xs" />
                              <input type="date" value={editBlackoutEnd} onChange={(e) => setEditBlackoutEnd(e.target.value)} className="input-field text-xs" />
                            </div>
                            <div className="flex gap-3">
                              <button onClick={() => void handleSaveBlackout(b.id)} disabled={savingBlackout} className="btn btn-primary text-xs py-1">
                                {savingBlackout ? "Saving…" : "Save"}
                              </button>
                              <button onClick={() => setEditingBlackoutId(null)} className="btn text-xs py-1" style={{ background: "transparent", border: "1px solid var(--circuit-border, var(--line))" }}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                            <span className="text-circuit-text">
                              <span className="font-medium">{label}</span>
                              <span className="text-circuit-muted ml-2">{start} — {end}</span>
                            </span>
                            <div className="flex gap-3 shrink-0">
                              <button onClick={() => startEditBlackout(b)} className="text-circuit-muted hover:text-circuit-text transition-colors">
                                Edit
                              </button>
                              <button onClick={() => void handleDeleteBlackout(b.id)} className="text-circuit-muted hover:text-red-400 transition-colors">
                                Remove
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {blackouts.length > BLACKOUT_PAGE_SIZE && (
                    <div className="flex items-center gap-3 pt-2 text-xs text-circuit-muted">
                      <button
                        disabled={blackoutListPage <= 1}
                        onClick={() => setBlackoutListPage((p) => p - 1)}
                        className="btn text-xs py-0.5 px-2 disabled:opacity-40"
                        style={{ background: "transparent", border: "1px solid var(--circuit-border, var(--line))" }}
                      >
                        ← Prev
                      </button>
                      <span>Page {blackoutListPage} of {Math.ceil(blackouts.length / BLACKOUT_PAGE_SIZE)}</span>
                      <button
                        disabled={blackoutListPage >= Math.ceil(blackouts.length / BLACKOUT_PAGE_SIZE)}
                        onClick={() => setBlackoutListPage((p) => p + 1)}
                        className="btn text-xs py-0.5 px-2 disabled:opacity-40"
                        style={{ background: "transparent", border: "1px solid var(--circuit-border, var(--line))" }}
                      >
                        Next →
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Sleep overrides */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">Sleep &amp; recovery</h2>
        <div className="panel p-5 space-y-4">
          <p className="text-xs text-circuit-muted">
            Bedtime and wake time are read from your <span className="font-medium text-circuit-text">Sleep</span> calendar event
            (start time + duration). Override quality or disturbed sleep below when last night was unusual — otherwise your default quality applies.
          </p>

          {todaySleep && (
            <div className="rounded border border-circuit-border px-3 py-2 text-xs text-circuit-muted space-y-1">
              <p className="text-circuit-text font-medium">Today&apos;s baseline ({todaySleep.date})</p>
              <p>
                {todaySleep.duration_h != null ? `${todaySleep.duration_h.toFixed(1)}h` : "—"}
                {todaySleep.bedtime_ms != null && todaySleep.wake_ms != null
                  ? ` · ${fmtSleepTime(todaySleep.bedtime_ms)} → ${fmtSleepTime(todaySleep.wake_ms)}`
                  : ""}
                {todaySleep.source === "task" && " · from Sleep task"}
                {todaySleep.source === "mixed" && " · Sleep task + overrides"}
                {todaySleep.source === "default" && " · from default schedule"}
              </p>
            </div>
          )}

          {editingSleepDate && (
            <div className="rounded border border-circuit-accent/40 bg-circuit-accent/5 px-3 py-2 text-xs flex items-center justify-between gap-3">
              <span className="text-circuit-text">
                Editing overrides for <span className="font-medium">{editingSleepDate}</span>
                {editingSleepDate === todayIST() ? " (today)" : ""}
              </span>
              <button
                type="button"
                onClick={cancelEditSleepOverride}
                className="text-circuit-muted hover:text-circuit-text shrink-0"
              >
                Cancel
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-circuit-muted">
                Sleep quality override (0–10)
              </span>
              <input
                type="number" min={0} max={10} step={1}
                value={sleepQuality}
                onChange={(e) => setSleepQuality(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder={`default ${Number(vals.default_sleep_quality ?? 7)}`}
                className="input-field"
              />
            </label>
            <label className="flex items-center gap-3 pt-5 cursor-pointer">
              <input
                type="checkbox"
                checked={sleepDisturbed}
                onChange={(e) => setSleepDisturbed(e.target.checked)}
                className="accent-circuit-accent"
              />
              <span className="text-xs text-circuit-muted">Disturbed / fragmented sleep</span>
            </label>
          </div>
          <input
            type="text"
            value={sleepNotes}
            onChange={(e) => setSleepNotes(e.target.value)}
            placeholder="Notes (optional — e.g. sick, loud night)"
            className="input-field w-full"
            maxLength={500}
          />
          <div className="flex flex-wrap items-center gap-4">
            <button onClick={handleLogSleep} disabled={sleepSaving} className="btn btn-primary">
              {sleepSaving ? "Saving…" : editingSleepDate ? "Save changes" : "Save overrides"}
            </button>
            <button
              type="button"
              onClick={() => void toggleSleepHistory()}
              className="btn text-xs"
              style={{ background: "transparent", border: "1px solid var(--circuit-border, var(--line))" }}
            >
              {showSleepHistory ? "Hide sleep overrides" : "Show sleep overrides"}
              {!showSleepHistory && sleepOverrideTotal > 0 ? ` (${sleepOverrideTotal})` : ""}
            </button>
            {sleepMsg && <span className="text-xs text-circuit-muted">{sleepMsg}</span>}
            {sleepErr && <span className="text-xs text-red-400">{sleepErr}</span>}
          </div>

          {showSleepHistory && (
            <div className="space-y-2 pt-1 border-t border-circuit-border">
              {sleepHistoryLoading ? (
                <p className="text-xs text-circuit-muted pt-2">Loading…</p>
              ) : sleepOverrides.length === 0 ? (
                <p className="text-xs text-circuit-muted pt-2">No sleep overrides saved yet.</p>
              ) : (
                <>
                  <p className="text-xs text-circuit-muted pt-2">
                    Saved overrides · {sleepOverrideTotal} total
                  </p>
                  {sleepOverrides.map((l) => (
                    <div
                      key={l.id ?? l.date}
                      className={`flex flex-col gap-1.5 text-xs py-2 border-b border-circuit-border last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${
                        editingSleepDate === l.date ? "bg-circuit-accent/5 -mx-1 px-1 rounded" : ""
                      }`}
                    >
                      <span className="text-circuit-text font-medium shrink-0">{l.date}</span>
                      <span className="text-circuit-muted sm:text-right flex-1 min-w-0">
                        {l.duration_h != null ? `${l.duration_h.toFixed(1)}h` : "—"}
                        {l.quality != null
                          ? l.quality_is_default
                            ? ` · ~${l.quality}/10`
                            : ` · ${l.quality}/10`
                          : ""}
                        {l.disturbed ? " · disturbed" : ""}
                        {l.notes ? ` · ${l.notes.slice(0, 40)}${l.notes.length > 40 ? "…" : ""}` : ""}
                      </span>
                      <span className="flex items-center gap-3 shrink-0">
                        <button
                          type="button"
                          onClick={() => beginEditSleepOverride(l)}
                          className="text-circuit-muted hover:text-circuit-text"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteSleepOverride(l)}
                          className="text-red-400/80 hover:text-red-400"
                        >
                          Delete
                        </button>
                      </span>
                    </div>
                  ))}
                  {sleepOverridePages > 1 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                      <button
                        type="button"
                        disabled={sleepOverridePage <= 1 || sleepHistoryLoading}
                        onClick={() => void loadSleepOverrides(sleepOverridePage - 1)}
                        className="btn text-xs"
                        style={{ background: "transparent", border: "1px solid var(--circuit-border, var(--line))" }}
                      >
                        Previous
                      </button>
                      <span className="text-xs text-circuit-muted">
                        Page {sleepOverridePage} of {sleepOverridePages}
                      </span>
                      <button
                        type="button"
                        disabled={sleepOverridePage >= sleepOverridePages || sleepHistoryLoading}
                        onClick={() => void loadSleepOverrides(sleepOverridePage + 1)}
                        className="btn text-xs"
                        style={{ background: "transparent", border: "1px solid var(--circuit-border, var(--line))" }}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Export */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">Export data</h2>
        <form onSubmit={handleExport} className="panel p-5 space-y-3">
          <p className="text-xs text-circuit-muted">
            Download an AES-256 encrypted backup of all your tasks and settings.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="password" value={exportPass} onChange={(e) => setExportPass(e.target.value)}
              placeholder="Passphrase (min 8 chars)" minLength={8} required
              className="input-field flex-1"
            />
            <button type="submit" disabled={exporting} className="btn btn-primary shrink-0">
              {exporting ? "Exporting…" : "Export"}
            </button>
          </div>
          {exportErr && <p className="text-sm text-red-400">{exportErr}</p>}
          {exportResult && <p className="text-xs text-circuit-muted">Download started.</p>}
        </form>
      </section>

      {/* Import */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">Import data</h2>
        <form onSubmit={handleImport} className="panel p-5 space-y-3">
          <p className="text-xs text-circuit-muted">
            Paste an exported JSON blob to merge tasks into your account (deduplicates by client ID).
          </p>
          <input
            type="password" value={importPass} onChange={(e) => setImportPass(e.target.value)}
            placeholder="Passphrase" minLength={8} required
            className="input-field"
          />
          <textarea
            value={importBlob} onChange={(e) => setImportBlob(e.target.value)}
            placeholder='Paste exported JSON here…'
            rows={4} required
            className="input-field font-mono text-xs resize-y"
          />
          <div className="flex items-center gap-4">
            <button type="submit" disabled={importing} className="btn btn-primary">
              {importing ? "Importing…" : "Import"}
            </button>
            {importResult && <span className="text-xs text-circuit-muted">{importResult}</span>}
          </div>
          {importErr && <p className="text-sm text-red-400">{importErr}</p>}
        </form>
      </section>

      {vanillaStores.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">Import from browser (vanilla PWA)</h2>
          <div className="panel p-5 space-y-3">
            <p className="text-xs text-circuit-muted">
              Found tasks saved in this browser from the standalone Circuit app. Import merges by client ID — duplicates are skipped.
            </p>
            <ul className="space-y-2">
              {vanillaStores.map((store) => (
                <li key={store.key} className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <span className="text-circuit-muted font-mono text-xs truncate">{store.key}</span>
                  <span className="text-circuit-text shrink-0">{store.count} tasks</span>
                  <button
                    type="button"
                    disabled={migratingKey !== null}
                    onClick={() => void handleVanillaMigrate(store.key)}
                    className="btn btn-primary shrink-0 text-xs"
                  >
                    {migratingKey === store.key ? "Importing…" : "Import"}
                  </button>
                </li>
              ))}
            </ul>
            {migrateErr && <p className="text-sm text-red-400">{migrateErr}</p>}
            {migrateResult && <p className="text-xs text-circuit-muted">{migrateResult}</p>}
          </div>
        </section>
      )}

      {/* Data management */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">Data management</h2>
        <div className="panel p-5 space-y-3">
          <p className="text-xs text-circuit-muted">
            Remove far-future recurring events to reduce app load.
            Only events with a specific scheduled date are affected — tasks with no date are untouched.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <label className="text-xs text-circuit-muted shrink-0">Delete events after</label>
            <input
              type="date"
              value={cleanupAfterDate}
              onChange={(e) => { setCleanupAfterDate(e.target.value); setCleanupConfirm(false); setCleanupMsg(null); }}
              className="input-field"
            />
          </div>
          {!cleanupConfirm ? (
            <button
              onClick={() => setCleanupConfirm(true)}
              className="text-xs text-circuit-muted hover:text-red-500 transition-colors"
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              Clean up future data…
            </button>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                onClick={handleCleanup}
                disabled={cleaning}
                className="btn btn-primary text-xs"
                style={{ background: "var(--terra)", borderColor: "var(--terra)" }}
              >
                {cleaning ? "Deleting…" : `Yes, delete events after ${cleanupAfterDate}`}
              </button>
              <button
                onClick={() => setCleanupConfirm(false)}
                className="text-xs text-circuit-muted hover:text-circuit-text transition-colors"
                style={{ background: "none", border: "none", cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          )}
          {cleanupMsg && <p className="text-xs text-circuit-muted">{cleanupMsg}</p>}
          {cleanupErr && <p className="text-xs text-red-400">{cleanupErr}</p>}
        </div>
      </section>

      {/* Security */}
      {passkeySupported && (
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">Security</h2>
          <div className="panel p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-medium text-circuit-text">Biometric sign-in</p>
                <p className="text-xs text-circuit-muted mt-1">
                  {passkeyRegistered
                    ? "Passkey registered on this device — sign in with Face ID or fingerprint."
                    : "Register a passkey to sign in with Face ID or fingerprint."}
                </p>
                {passkeyErr && <p className="text-sm text-red-400 mt-2">{passkeyErr}</p>}
              </div>
              {passkeyRegistered ? (
                <span className="shrink-0 text-xs text-circuit-accent border border-circuit-accent/30 rounded px-2 py-1">
                  Enabled
                </span>
              ) : (
                <button onClick={handleEnablePasskey} disabled={passkeyBusy} className="btn btn-primary shrink-0 text-xs">
                  {passkeyBusy ? "Setting up…" : "Enable"}
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Danger zone */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-red-400 uppercase tracking-wider">Danger zone</h2>
        <div className="panel border-red-400/30 p-5 space-y-3">
          <p className="text-sm text-circuit-muted">
            Delete all tasks, settings, and history for this account. Your login is retained.
          </p>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-sm text-red-400 hover:text-red-300 transition-colors"
            >
              Delete all my data
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-red-400 font-medium">Are you sure? This cannot be undone.</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={handleDeleteData} disabled={deleting}
                  className="px-4 py-2 rounded-lg bg-red-500/20 border border-red-400/40 text-sm text-red-400 hover:bg-red-500/30 transition-colors"
                >
                  {deleting ? "Deleting…" : "Yes, delete everything"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-sm text-circuit-muted hover:text-circuit-text transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
