import { describe, expect, it } from "vitest";
import { isValidRevisionTransition } from "../../modules/publishing/revisionTransitions";

describe("isValidRevisionTransition", () => {
  it("allows DRAFT -> PUBLISHED (publishing by moving the pointer, ADR §5.3)", () => {
    expect(isValidRevisionTransition("DRAFT", "PUBLISHED")).toBe(true);
  });

  it("allows PUBLISHED -> SUPERSEDED (a later draft is published, ADR §5.3)", () => {
    expect(isValidRevisionTransition("PUBLISHED", "SUPERSEDED")).toBe(true);
  });

  it("never allows a PUBLISHED revision back to DRAFT", () => {
    expect(isValidRevisionTransition("PUBLISHED", "DRAFT")).toBe(false);
  });

  it("never allows DRAFT directly to SUPERSEDED", () => {
    expect(isValidRevisionTransition("DRAFT", "SUPERSEDED")).toBe(false);
  });

  it("treats SUPERSEDED as terminal — no transitions out of it", () => {
    expect(isValidRevisionTransition("SUPERSEDED", "DRAFT")).toBe(false);
    expect(isValidRevisionTransition("SUPERSEDED", "PUBLISHED")).toBe(false);
  });
});
