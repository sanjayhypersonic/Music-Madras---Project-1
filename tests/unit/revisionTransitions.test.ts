import { describe, expect, it } from "vitest";
import {
  canForkNewDraft,
  canPublishCurrentDraft,
  isValidRevisionTransition,
} from "../../modules/publishing/revisionTransitions";

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

describe("canForkNewDraft (edit-after-publish precondition, ADR §5.3/§5.4)", () => {
  it("allows forking when there is a published revision and no open draft", () => {
    expect(canForkNewDraft({ hasOpenDraft: false, hasPublishedRevision: true })).toBe(true);
  });

  it("refuses to fork a second draft while one is already open", () => {
    expect(canForkNewDraft({ hasOpenDraft: true, hasPublishedRevision: true })).toBe(false);
  });

  it("refuses to fork when there is nothing published yet", () => {
    expect(canForkNewDraft({ hasOpenDraft: false, hasPublishedRevision: false })).toBe(false);
  });
});

describe("canPublishCurrentDraft", () => {
  it("allows publishing when a draft is open", () => {
    expect(canPublishCurrentDraft({ hasOpenDraft: true })).toBe(true);
  });

  it("refuses to publish when there is no open draft", () => {
    expect(canPublishCurrentDraft({ hasOpenDraft: false })).toBe(false);
  });
});
