import { parseAndClassifyTasks } from '../../src/app/import';

describe('parseAndClassifyTasks', () => {
  test('parses plain tasks', () => {
    const result = parseAndClassifyTasks('Buy milk\nWrite report\nCall mom');
    expect(result).toHaveLength(3);
    expect(result[0]!.text).toBe('Buy milk');
  });

  test('removes list markers', () => {
    const result = parseAndClassifyTasks('- Task 1\n* Task 2\n1. Task 3');
    expect(result[0]!.text).toBe('Task 1');
    expect(result[2]!.text).toBe('Task 3');
  });

  test('classifies work tasks', () => {
    const result = parseAndClassifyTasks('Review code\nFix bug');
    expect(result[0]!.tag).toBe('work');
  });

  test('detects effort levels', () => {
    const result = parseAndClassifyTasks('Quick task\nComplex project');
    expect(result[0]!.effort).toBe('low');
    expect(result[1]!.effort).toBe('high');
  });
});
