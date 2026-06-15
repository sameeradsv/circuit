"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiBlackout, ApiSettings, ApiUserState } from "@/lib/api";
import { useCircuitAuth } from "@/lib/use-circuit-auth";
import { usePasskey } from "@/lib/usePasskey";

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

  // blackout state
  const [blackouts, setBlackouts] = useState<ApiBlackout[]>([]);
  const [newBlackoutType, setNewBlackoutType] = useState("travelling");
  const today = new Date().toISOString().slice(0, 10);
  const [newBlackoutStart, setNewBlackoutStart] = useState(today);
  const [newBlackoutEnd, setNewBlackoutEnd] = useState(today);
  const [addingBlackout, setAddingBlackout] = useState(false);
  const [blackoutMsg, setBlackoutMsg] = useState<string | null>(null);
  const [blackoutErr, setBlackoutErr] = useState<string | null>(null);

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
    Promise.all([api.getSettings(), api.getUserState(), api.listBlackouts()])
      .then(([s, st, bl]) => { setSettings(s); setState(st); setBlackouts(bl); })
      .catch(() => {});
  }, [user]);

  async function handleAddBlackout() {
    if (!newBlackoutStart || !newBlackoutEnd) return;
    setAddingBlackout(true);
    setBlackoutErr(null);
    setBlackoutMsg(null);
    try {
      const startMs = new Date(newBlackoutStart).getTime();
      const endMs = new Date(newBlackoutEnd).getTime() + 86_399_999; // end of day
      const b = await api.createBlackout({ blackout_type: newBlackoutType, start_date_ms: startMs, end_date_ms: endMs });
      setBlackouts((prev) => [...prev, b].sort((a, b) => a.start_date_ms - b.start_date_ms));
      setBlackoutMsg("Blackout added.");
    } catch (e) {
      setBlackoutErr(e instanceof Error ? e.message : "Failed to add blackout");
    } finally {
      setAddingBlackout(false);
    }
  }

  async function handleDeleteBlackout(id: number) {
    try {
      await api.deleteBlackout(id);
      setBlackouts((prev) => prev.filter((b) => b.id !== id));
    } catch (e) {
      setBlackoutErr(e instanceof Error ? e.message : "Failed to remove blackout");
    }
  }

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

      {/* Blackouts */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">Blackouts</h2>
        <div className="panel p-5 space-y-4">
          <p className="text-xs text-circuit-muted">
            Mark dates when you're unavailable. Tasks flagged to skip during these times will be grayed out in your task list.
          </p>

          <div className="flex flex-wrap gap-3 items-end">
            <label className="space-y-1">
              <span className="text-xs text-circuit-muted">Type</span>
              <select
                value={newBlackoutType}
                onChange={(e) => setNewBlackoutType(e.target.value)}
                className="input-field"
              >
                <option value="travelling">Travelling</option>
                <option value="period">Period</option>
                <option value="sickness">Sickness</option>
                <option value="leave">On leave</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-circuit-muted">From</span>
              <input
                type="date"
                value={newBlackoutStart}
                onChange={(e) => { setNewBlackoutStart(e.target.value); setBlackoutMsg(null); }}
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
              className="btn-primary"
            >
              {addingBlackout ? "Adding…" : "Add"}
            </button>
          </div>

          {blackoutErr && <p className="text-sm text-red-400">{blackoutErr}</p>}
          {blackoutMsg && <p className="text-xs text-circuit-muted">{blackoutMsg}</p>}

          {blackouts.length > 0 && (
            <div className="space-y-1 pt-1">
              {blackouts.map((b) => {
                const start = new Date(b.start_date_ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
                const end = new Date(b.end_date_ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
                const label = b.blackout_type.charAt(0).toUpperCase() + b.blackout_type.slice(1);
                return (
                  <div key={b.id} className="flex items-center justify-between text-xs py-2 border-b border-circuit-border last:border-0">
                    <span className="text-circuit-text">
                      <span className="font-medium">{label}</span>
                      <span className="text-circuit-muted ml-2">{start} — {end}</span>
                    </span>
                    <button
                      onClick={() => handleDeleteBlackout(b.id)}
                      className="text-circuit-muted hover:text-red-400 transition-colors ml-4 shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
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

      {/* Data management */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-circuit-muted uppercase tracking-wider">Data management</h2>
        <div className="panel p-5 space-y-3">
          <p className="text-xs text-circuit-muted">
            Remove far-future recurring events to reduce app load.
            Only events with a specific scheduled date are affected — tasks with no date are untouched.
          </p>
          <div className="flex items-center gap-3">
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
            <div className="flex items-center gap-3">
              <button
                onClick={handleCleanup}
                disabled={cleaning}
                className="btn-primary text-xs"
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
            <div className="flex items-start justify-between gap-4">
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
                <button onClick={handleEnablePasskey} disabled={passkeyBusy} className="btn-primary shrink-0 text-xs">
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
