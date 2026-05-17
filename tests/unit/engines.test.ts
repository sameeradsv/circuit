import { taskFromConversationalInput } from '../../src/ai-assistance';
import { parseIcs, syncFromCalendar, tasksToIcs } from '../../src/calendar-sync';
import { buildSchedule } from '../../src/scheduling-engine';
import { handleSkip, rescheduleAll } from '../../src/rescheduling-engine';
import { createTask, validateTask } from '../../src/task-engine';
import type { ScheduleContext } from '../../src/types';

describe('task schema', () => {
  test('creates valid task with dimensions', () => {
    const task = createTask('Write report', { tag: 'work', effort: 'high' });
    const { valid } = validateTask(task);
    expect(valid).toBe(true);
    expect(task.cognitiveLoad).toBeGreaterThan(0.5);
    expect(task.focusType).toBe('deep');
  });
});

describe('scheduling engine', () => {
  test('orders pending tasks by score', () => {
    const tasks = [
      createTask('Quick email', { effort: 'low', urgency: 0.9 }),
      createTask('Big project', { effort: 'high', urgency: 0.2 }),
    ];
    const ctx: ScheduleContext = {
      mode: 'normal',
      now: Date.now(),
      availableMinutes: 240,
      completedToday: 0,
    };
    const plan = buildSchedule(tasks, ctx);
    expect(plan.ordered.length).toBeGreaterThan(0);
    expect(plan.explanation).toContain('Quick email');
  });
});

describe('rescheduling engine', () => {
  test('skip increments count and defers', () => {
    const task = createTask('Test');
    const { tasks } = handleSkip([task], task.id);
    expect(tasks[0]!.skippedCount).toBe(1);
    expect(tasks[0]!.scheduledAt).toBeTruthy();
  });

  test('rescheduleAll returns tasks', () => {
    const tasks = [createTask('A'), createTask('B')];
    const { tasks: next } = rescheduleAll(tasks, 'low');
    expect(next).toHaveLength(2);
  });
});

describe('ai assistance', () => {
  test('parses conversational add', () => {
    const task = taskFromConversationalInput('remind me to call mom tomorrow');
    expect(task).not.toBeNull();
    expect(task!.text.toLowerCase()).toContain('call mom');
  });
});

describe('calendar sync', () => {
  test('imports ICS events as scheduled tasks and skips duplicates', () => {
    const events = parseIcs(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:meeting-1
DTSTART:20260518T090000Z
DTEND:20260518T100000Z
SUMMARY:Planning review
END:VEVENT
END:VCALENDAR`);

    const first = syncFromCalendar([], events);
    const second = syncFromCalendar(first.tasks, events);

    expect(first.imported).toBe(1);
    expect(first.tasks[0]!.scheduledAt).toBeTruthy();
    expect(first.tasks[0]!.duration).toBe(60);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
  });

  test('exports scheduled recurring tasks as ICS', () => {
    const task = createTask('Weekly planning', {
      scheduledAt: Date.UTC(2026, 4, 18, 9, 0, 0),
      recurrence: 'weekly',
      duration: 30,
    });

    const ics = tasksToIcs([task]);

    expect(ics).toContain('SUMMARY:Weekly planning');
    expect(ics).toContain('RRULE:FREQ=WEEKLY');
    expect(ics).toContain('DTSTART:20260518T090000Z');
  });
});
