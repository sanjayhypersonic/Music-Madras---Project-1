import { describe, expect, it } from "vitest";
import { computeObservabilityUpdate } from "../../modules/youtube/availability/computeObservabilityUpdate";

describe("computeObservabilityUpdate", () => {
  it("a brand-new row (OBSERVED default) that is observed stays OBSERVED with no transition", () => {
    const result = computeObservabilityUpdate("OBSERVED", true);
    expect(result).toEqual({ nextState: "OBSERVED", changed: false });
  });

  it("an OBSERVED row not seen this pass becomes NOT_OBSERVED", () => {
    const result = computeObservabilityUpdate("OBSERVED", false);
    expect(result).toEqual({ nextState: "NOT_OBSERVED", changed: true });
  });

  it("a NOT_OBSERVED row seen again recovers to OBSERVED", () => {
    const result = computeObservabilityUpdate("NOT_OBSERVED", true);
    expect(result).toEqual({ nextState: "OBSERVED", changed: true });
  });

  it("never escalates a repeated absence beyond NOT_OBSERVED — no deletion evidence is invented here", () => {
    const result = computeObservabilityUpdate("NOT_OBSERVED", false);
    expect(result).toEqual({ nextState: "NOT_OBSERVED", changed: false });
  });

  it("a DELETED row stays DELETED regardless of this pass's observation (escalation/recovery from DELETED is not this function's job)", () => {
    expect(computeObservabilityUpdate("DELETED", false)).toEqual({ nextState: "DELETED", changed: false });
  });
});
