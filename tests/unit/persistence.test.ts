import { createTask, loadTasks, saveTasks } from '../../src/task-engine';

describe('localStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('circuit storage key', () => {
    localStorage.setItem('circuit_tasks_v1', JSON.stringify([]));
    expect(localStorage.getItem('circuit_tasks_v1')).toBe('[]');
  });

  test('theme persistence', () => {
    localStorage.setItem('circuit_theme', 'ocean');
    expect(localStorage.getItem('circuit_theme')).toBe('ocean');
  });
});

describe('persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('round-trips tasks through localStorage', () => {
    const task = createTask('Persistent task');
    saveTasks([task]);
    const loaded = loadTasks();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.text).toBe('Persistent task');
    expect(loaded[0]!.id).toBe(task.id);
  });

  test('migrates legacy my_tasks_v2 storage', () => {
    localStorage.setItem(
      'my_tasks_v2',
      JSON.stringify([{ id: 1, text: 'Legacy', completed: false, tag: 'general' }]),
    );
    const loaded = loadTasks();
    expect(loaded[0]!.text).toBe('Legacy');
    expect(localStorage.getItem('circuit_tasks_v1')).toBeTruthy();
  });
});
