import { describe, expect, it } from "vitest";
import { canTransitionFieldOwnership } from "../../modules/youtube/ownership/fieldOwnershipTransitions";

describe("canTransitionFieldOwnership", () => {
  it("allows YOUTUBE_CONTROLLED -> MUSIC_MADRAS_CONTROLLED (an editor overrides a synced field, ADR §16.2)", () => {
    expect(canTransitionFieldOwnership("YOUTUBE_CONTROLLED", "MUSIC_MADRAS_CONTROLLED")).toBe(true);
  });

  it("allows MUSIC_MADRAS_CONTROLLED -> YOUTUBE_CONTROLLED (accept-external conflict resolution, ADR §16.3)", () => {
    expect(canTransitionFieldOwnership("MUSIC_MADRAS_CONTROLLED", "YOUTUBE_CONTROLLED")).toBe(true);
  });

  it("never allows a transition into or out of SHARED_REQUIRES_REVIEW via this mechanism", () => {
    expect(canTransitionFieldOwnership("SHARED_REQUIRES_REVIEW", "YOUTUBE_CONTROLLED")).toBe(false);
    expect(canTransitionFieldOwnership("SHARED_REQUIRES_REVIEW", "MUSIC_MADRAS_CONTROLLED")).toBe(false);
    expect(canTransitionFieldOwnership("YOUTUBE_CONTROLLED", "SHARED_REQUIRES_REVIEW")).toBe(false);
    expect(canTransitionFieldOwnership("MUSIC_MADRAS_CONTROLLED", "SHARED_REQUIRES_REVIEW")).toBe(false);
  });

  it("never allows a no-op transition to itself to be treated as a special case beyond the table", () => {
    expect(canTransitionFieldOwnership("YOUTUBE_CONTROLLED", "YOUTUBE_CONTROLLED")).toBe(false);
  });
});
