import { describe, expect, it } from "vitest";
import { createEphemeralSessionId } from "../../modules/analytics/createEphemeralSessionId";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("createEphemeralSessionId", () => {
  it("returns a UUID-shaped string", () => {
    expect(createEphemeralSessionId()).toMatch(UUID_PATTERN);
  });

  it("returns a different value on each call — never reused across calls", () => {
    const first = createEphemeralSessionId();
    const second = createEphemeralSessionId();
    expect(first).not.toBe(second);
  });
});
