import { describe, expect, it } from "vitest";
import { expandReminderOccurrences } from "../../src/server/reminders/recurrence";
import type { TaskReminderSource } from "../../src/server/reminders/db";

function task(overrides: Partial<TaskReminderSource>): TaskReminderSource {
  return {
    id: 1,
    user_id: 7,
    text: "Standup",
    scheduled_at: Date.UTC(2026, 0, 5, 9, 0),
    recurrence: null,
    recurrence_ends_at: null,
    completed: false,
    notifications_enabled: true,
    notification_offset_1_mins: 10,
    notification_offset_2_mins: null,
    ...overrides,
  };
}

describe("expandReminderOccurrences", () => {
  it("creates reminders for one-time tasks with multiple offsets", () => {
    const occurrences = expandReminderOccurrences(
      [task({ notification_offset_2_mins: 0 })],
      new Date(Date.UTC(2026, 0, 5, 8, 0)),
      new Date(Date.UTC(2026, 0, 5, 10, 0)),
    );

    expect(occurrences.map((item) => item.remindAt.toISOString())).toEqual([
      "2026-01-05T08:50:00.000Z",
      "2026-01-05T09:00:00.000Z",
    ]);
  });

  it("materializes a finite daily recurrence window", () => {
    const occurrences = expandReminderOccurrences(
      [task({ recurrence: "daily" })],
      new Date(Date.UTC(2026, 0, 5, 0, 0)),
      new Date(Date.UTC(2026, 0, 7, 23, 59)),
    );

    expect(occurrences).toHaveLength(3);
    expect(occurrences[2].occurrenceAtMs).toBe(Date.UTC(2026, 0, 7, 9, 0));
  });

  it("honors weekly day filters", () => {
    const occurrences = expandReminderOccurrences(
      [task({ recurrence: "weekly:MO,WE,FR" })],
      new Date(Date.UTC(2026, 0, 5, 0, 0)),
      new Date(Date.UTC(2026, 0, 11, 23, 59)),
    );

    expect(occurrences.map((item) => new Date(item.occurrenceAtMs).getUTCDay())).toEqual([1, 3, 5]);
  });

  it("does not schedule disabled notifications", () => {
    expect(
      expandReminderOccurrences(
        [task({ notifications_enabled: false })],
        new Date(Date.UTC(2026, 0, 5, 0, 0)),
        new Date(Date.UTC(2026, 0, 5, 23, 59)),
      ),
    ).toEqual([]);
  });
});
