"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiSettings, ApiUserState } from "@/lib/api";
import { useCircuitAuth } from "@/lib/use-circuit-auth";

const ENERGY_MODES = ["normal", "deep", "low", "social"] as const;

export default function AccountPage() {
  const { user, loading, logout } = useCircuitAuth();
  const router = useRouter();

  const [settings, setSettings] = useState<ApiSettings | null>(null);
  const [state, setState] = useState<ApiUserState | null>(null);
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

  // danger zone
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    Promise.all([api.getSettings(), api.getUserState()])
      .then(([s, st]) => { setSettings(s); setState(st); })
      .catch(() => {});
  }, [user]);

  if (loading || !user) return null;

  const vals = settings?.values ?? {};

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
      });
      const newState = await api.setUserState({
        energy_level: Number(data.get("energy_level")),
        stress_level: Number(data.get("stress_level")),
        time_available_minutes: Number(data.get("time_available_minutes")),
        focus_mode: data.get("focus_mode") as string,
      });
      setSettings(newSettings);
      setState(newState);
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
            onClick={() => { logout(); router.push("/login"); }}
            className="ml-4 text-xs text-circuit-muted hover:text-circuit-text transition-colors"
          >
            Sign out
          </button>
        </p>
      </div>

      {/* Preferences */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">Preferences</h2>
        <form onSubmit={savePreferences} className="panel p-5 space-y-5">
          <div className="grid grid-cols-2 gap-4">
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
          </div>

          <hr className="border-circuit-border" />
          <p className="text-xs font-medium text-circuit-muted uppercase tracking-wider">Today's context</p>
          <div className="grid grid-cols-2 gap-4">
            <label className="space-y-1">
              <span className="text-xs text-circuit-muted">
                Energy level {state ? `${Math.round(state.energy_level * 100)}%` : ""}
              </span>
              <input
                type="range" name="energy_level" min={0} max={1} step={0.05}
                defaultValue={state?.energy_level ?? 0.7}
                className="w-full accent-circuit-accent"
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
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Saving…" : "Save preferences"}
            </button>
            {saveMsg && <span className="text-xs text-circuit-muted">{saveMsg}</span>}
          </div>
        </form>
      </section>

      {/* Export */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">Export data</h2>
        <form onSubmit={handleExport} className="panel p-5 space-y-3">
          <p className="text-xs text-circuit-muted">
            Download an AES-256 encrypted backup of all your tasks and settings.
          </p>
          <div className="flex gap-3">
            <input
              type="password" value={exportPass} onChange={(e) => setExportPass(e.target.value)}
              placeholder="Passphrase (min 8 chars)" minLength={8} required
              className="input-field flex-1"
            />
            <button type="submit" disabled={exporting} className="btn-primary shrink-0">
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
            <button type="submit" disabled={importing} className="btn-primary">
              {importing ? "Importing…" : "Import"}
            </button>
            {importResult && <span className="text-xs text-circuit-muted">{importResult}</span>}
          </div>
          {importErr && <p className="text-sm text-red-400">{importErr}</p>}
        </form>
      </section>

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
              <div className="flex gap-3">
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
