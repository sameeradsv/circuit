import { taskFromConversationalInput } from '../../src/ai-assistance';
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
