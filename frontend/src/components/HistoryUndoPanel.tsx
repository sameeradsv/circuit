"use client";

import { useEffect, useState } from "react";
import { api, ApiTaskEvent } from "@/lib/api";

function eventLabel(event: ApiTaskEvent): string {
  const label = event.event_type.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function eventTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export function HistoryUndoPanel() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<ApiTaskEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [undoing, setUndoing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setEvents(await api.listEvents(40));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load history");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open]);

  async function undo(event: ApiTaskEvent) {
    setUndoing(event.id);
    setError(null);
    try {
      await api.undoEvent(event.id);
      await load();
      window.dispatchEvent(new CustomEvent("circuit:history-undone", { detail: { eventId: event.id } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not undo event");
    } finally {
      setUndoing(null);
    }
  }

  return (
    <>
      <button
        type="button"
        className="history-fab"
        onClick={() => setOpen(true)}
        title="History and undo"
      >
        History
      </button>
      {open && (
        <>
          <button type="button" className="history-backdrop" aria-label="Close history" onClick={() => setOpen(false)} />
          <aside className="history-panel" aria-label="History and undo">
            <div className="between">
              <div>
                <p className="label">History</p>
                <h2 className="display" style={{ fontSize: 28 }}>Undo actions</h2>
              </div>
              <button type="button" className="btn-icon" aria-label="Close history" onClick={() => setOpen(false)}>
                x
              </button>
            </div>

            {error && <p className="history-error">{error}</p>}
            {loading && <p className="muted">Loading...</p>}

            {!loading && events.length === 0 && (
              <p className="muted">No task history yet.</p>
            )}

            <div className="history-list">
              {events.map((event) => (
                <div key={event.id} className="history-item">
                  <div className="history-item-main">
                    <span className="history-event-type">{eventLabel(event)}</span>
                    <span className="history-task-text">{event.task_text ?? `Task ${event.task_id}`}</span>
                    <span className="history-time">{eventTime(event.occurred_at)}</span>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    disabled={!event.undoable || undoing === event.id}
                    onClick={() => undo(event)}
                    title={event.undoable ? "Undo this history event" : "This event cannot be undone"}
                  >
                    {undoing === event.id ? "Undoing..." : "Undo"}
                  </button>
                </div>
              ))}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
