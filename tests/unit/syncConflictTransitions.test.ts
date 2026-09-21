import { describe, expect, it } from "vitest";
import { canTransitionSyncConflictStatus } from "../../modules/youtube/ownership/syncConflictTransitions";

describe("canTransitionSyncConflictStatus", () => {
  it("allows OPEN -> RESOLVED", () => {
    expect(canTransitionSyncConflictStatus("OPEN", "RESOLVED")).toBe(true);
  });

  it("allows OPEN -> IGNORED", () => {
    expect(canTransitionSyncConflictStatus("OPEN", "IGNORED")).toBe(true);
  });

  it("treats RESOLVED as terminal", () => {
    expect(canTransitionSyncConflictStatus("RESOLVED", "OPEN")).toBe(false);
    expect(canTransitionSyncConflictStatus("RESOLVED", "IGNORED")).toBe(false);
  });

  it("treats IGNORED as terminal", () => {
    expect(canTransitionSyncConflictStatus("IGNORED", "OPEN")).toBe(false);
    expect(canTransitionSyncConflictStatus("IGNORED", "RESOLVED")).toBe(false);
  });
});
