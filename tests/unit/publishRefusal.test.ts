import { describe, expect, it } from "vitest";
import { describePublishRefusal, type PublishRefusalReason } from "../../modules/publishing/publishRefusal";
import { describeEditableDraftRefusal } from "../../modules/publishing/editableDraftRefusal";

// Phase 6J-10B — every reason a publication can be refused has a safe, explicit editor message.
const ALL: PublishRefusalReason[] = ["RECORDING_NOT_FOUND", "RECORDING_ARCHIVED", "NO_OPEN_DRAFT", "STALE_REVISION", "NOT_READY", "STATE_CHANGED", "PERFORMANCE_CHANGED", "BUSY", "FAILED"];

describe("describePublishRefusal", () => {
  it("has a non-empty message for every reason, and none mentions a database, SQL or an internal error", () => {
    for (const reason of ALL) {
      const message = describePublishRefusal(reason, ["Identity"]);
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/prisma|sql|postgres|constraint|transaction|lock|P20\d\d|stack/i);
    }
  });

  it("reuses the existing draft-refusal wording for the shared reasons", () => {
    for (const reason of ["RECORDING_NOT_FOUND", "RECORDING_ARCHIVED", "NO_OPEN_DRAFT", "STALE_REVISION"] as const) {
      expect(describePublishRefusal(reason)).toBe(describeEditableDraftRefusal(reason));
    }
  });

  it("names exactly what is still required for NOT_READY", () => {
    expect(describePublishRefusal("NOT_READY", ["Identity", "Musical Works"])).toBe("This recording is not ready to publish. Still required: Identity, Musical Works.");
    expect(describePublishRefusal("NOT_READY")).toBe("This recording is not ready to publish.");
  });

  it("tells the editor nothing was published for the transient reasons", () => {
    for (const reason of ["STATE_CHANGED", "PERFORMANCE_CHANGED", "BUSY", "FAILED"] as const) expect(describePublishRefusal(reason)).toMatch(/nothing was (published|changed)/i);
  });

  it("explains the participant conflict and the way out (discard, re-apply, publish again)", () => {
    const message = describePublishRefusal("PERFORMANCE_CHANGED");
    expect(message).toMatch(/participants/i);
    expect(message).toMatch(/Discard my participant changes/);
    expect(message).toMatch(/nothing was published/i);
  });
});
