import { computeSchedulingInsights } from "../../src/analytics-engine/scheduling-insights";
import { createTask } from "../../src/task-engine";

describe("computeSchedulingInsights", () => {
  test("flags large backlog", () => {
    const tasks = Array.from({ length: 5 }, (_, i) =>
      createTask(`Task ${i}`, { duration: 120, completed: false }),
    );
    const insights = computeSchedulingInsights(tasks);
    expect(insights.some((x) => x.message.includes("Backlog"))).toBe(true);
  });

  test("empty when no open tasks", () => {
    const tasks = [createTask("Done", { completed: true })];
    expect(computeSchedulingInsights(tasks)).toEqual([]);
  });
});
