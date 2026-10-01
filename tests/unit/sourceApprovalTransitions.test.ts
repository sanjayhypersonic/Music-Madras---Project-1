import { describe, expect, it } from "vitest";
import {
  canApproveSource,
  canDisableSource,
  canRejectSource,
  isValidSourceApprovalTransition,
  type SourceApprovalStateValue,
} from "../../modules/publishing/sourceApprovalTransitions";

// Phase 6H-8 — pure state-machine tests for Source.approvalState.

const ALL_STATES: SourceApprovalStateValue[] = ["UNREVIEWED", "APPROVED", "REJECTED", "DISABLED"];

describe("Source approval state transitions", () => {
  it("allows UNREVIEWED -> APPROVED or REJECTED only", () => {
    expect(canApproveSource("UNREVIEWED")).toBe(true);
    expect(canRejectSource("UNREVIEWED")).toBe(true);
    expect(canDisableSource("UNREVIEWED")).toBe(false);
  });

  it("allows APPROVED -> REJECTED or DISABLED, never back to UNREVIEWED", () => {
    expect(canRejectSource("APPROVED")).toBe(true);
    expect(canDisableSource("APPROVED")).toBe(true);
    expect(isValidSourceApprovalTransition("APPROVED", "UNREVIEWED")).toBe(false);
  });

  it("allows REJECTED and DISABLED to be re-reviewed back to APPROVED", () => {
    expect(canApproveSource("REJECTED")).toBe(true);
    expect(canApproveSource("DISABLED")).toBe(true);
  });

  it("never allows REJECTED or DISABLED to transition directly into each other", () => {
    expect(isValidSourceApprovalTransition("REJECTED", "DISABLED")).toBe(false);
    expect(isValidSourceApprovalTransition("DISABLED", "REJECTED")).toBe(false);
  });

  it("never allows a no-op transition to the same state", () => {
    for (const state of ALL_STATES) {
      expect(isValidSourceApprovalTransition(state, state)).toBe(false);
    }
  });

  it("APPROVED can never move straight back to UNREVIEWED — review is one-directional, re-approval is the only way back", () => {
    for (const state of ALL_STATES.filter((s) => s !== "UNREVIEWED")) {
      expect(isValidSourceApprovalTransition(state, "UNREVIEWED")).toBe(false);
    }
  });
});
