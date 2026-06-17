import { classifyUtteranceHeuristic, parseUtterance } from "../../src/ai-assistance/parse-utterance";

describe("parseUtterance", () => {
  test("extracts duration, tag, and cleans text", () => {
    const u = parseUtterance("reply to Sam #work 15m");
    expect(u.text.toLowerCase()).toContain("reply");
    expect(u.duration).toBe(15);
    expect(u.tag).toBe("work");
  });

  test("maps low energy to low effort", () => {
    const u = parseUtterance("quick email, low energy, 10m");
    expect(u.effort).toBe("low");
    expect(u.cognitive_load).toBeLessThanOrEqual(0.35);
  });

  test("classify heuristic detects social tag", () => {
    const c = classifyUtteranceHeuristic("coffee with Alex tomorrow");
    expect(c.tag).toBe("social");
  });

  test("urgency from EOD phrase", () => {
    const c = classifyUtteranceHeuristic("finish report by EOD");
    expect(c.urgency).toBeGreaterThanOrEqual(0.75);
  });
});
