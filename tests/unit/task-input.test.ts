import { mergeTaskDimensions, readDimensionOverrides } from '../../src/app/dimensions';
import { TASK_PRESETS, TASK_PRESET_IDS } from '../../src/app/task-presets';
import { createTask, validateTask } from '../../src/task-engine';

describe('task presets', () => {
  test('defines five editable presets', () => {
    expect(TASK_PRESET_IDS).toEqual(['chores', 'work', 'social', 'adhoc', 'meetup']);
  });

  test.each(TASK_PRESET_IDS)('%s produces a valid task', (id) => {
    const preset = TASK_PRESETS[id];
    const task = createTask('Sample', preset.defaults);
    const { valid } = validateTask(task);
    expect(valid).toBe(true);
    expect(task.duration).toBeGreaterThan(0);
  });

  test('work preset favors deep focus', () => {
    const task = createTask('Draft update', TASK_PRESETS.work.defaults);
    expect(task.tag).toBe('work');
    expect(task.focusType).toBe('deep');
    expect(task.cognitiveLoad).toBeGreaterThan(0.5);
  });

  test('meetup preset is time-sensitive', () => {
    const task = createTask('Coffee', TASK_PRESETS.meetup.defaults);
    expect(task.deadlineType).toBe('hard');
    expect(task.timeSensitivity).toBeGreaterThan(0.8);
  });
});

describe('dimension merge', () => {
  test('clamps normalized values', () => {
    const base = createTask('Test');
    const merged = mergeTaskDimensions(base, {
      urgency: 1.5,
      cognitiveLoad: -0.2,
      duration: 999,
    });
    expect(merged.urgency).toBe(1);
    expect(merged.cognitiveLoad).toBe(0);
    expect(merged.duration).toBe(480);
  });
});

describe('readDimensionOverrides', () => {
  test('reads list fields from the DOM', () => {
    document.body.innerHTML = `
      <input id="add-required-resources" value="laptop, charger" />
      <input id="add-dependencies" value="task-1, task-2" />
      <input id="add-duration" value="25" />
    `;

    const base = createTask('Test');
    const overrides = readDimensionOverrides('add', base);

    expect(overrides.requiredResources).toEqual(['laptop', 'charger']);
    expect(overrides.dependencies).toEqual(['task-1', 'task-2']);
    expect(overrides.duration).toBe(25);
  });
});
