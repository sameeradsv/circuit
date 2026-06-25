import { describe, expect, it } from "vitest";
import { isInvalidSubscriptionError } from "../../src/server/reminders/push";

describe("isInvalidSubscriptionError", () => {
  it("treats 404 and 410 as cleanup-worthy invalid subscriptions", () => {
    expect(isInvalidSubscriptionError({ statusCode: 404 })).toBe(true);
    expect(isInvalidSubscriptionError({ statusCode: 410 })).toBe(true);
  });

  it("keeps transient web push errors retryable", () => {
    expect(isInvalidSubscriptionError({ statusCode: 429 })).toBe(false);
    expect(isInvalidSubscriptionError({ statusCode: 503 })).toBe(false);
  });
});
