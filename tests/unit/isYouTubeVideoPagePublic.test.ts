import { describe, expect, it } from "vitest";
import { isYouTubeVideoPagePublic } from "../../modules/mmke/catalogue/isYouTubeVideoPagePublic";
import type { ObservabilityState } from "@prisma/client";

function makeInput(overrides: {
  status?: "DRAFT" | "PUBLISHED";
  archivedAt?: Date | null;
  privacyStatus?: string | null;
  observabilityState?: ObservabilityState;
  noPage?: boolean;
}) {
  return {
    page: overrides.noPage
      ? null
      : { status: overrides.status ?? "PUBLISHED", archivedAt: overrides.archivedAt ?? null },
    youtubeVideo: { privacyStatus: overrides.privacyStatus ?? "public", observabilityState: overrides.observabilityState ?? "OBSERVED" },
  };
}

describe("isYouTubeVideoPagePublic", () => {
  it("public YouTube + published page + active = public", () => {
    expect(isYouTubeVideoPagePublic(makeInput({}))).toBe(true);
  });

  it("public YouTube + draft page = not public", () => {
    expect(isYouTubeVideoPagePublic(makeInput({ status: "DRAFT" }))).toBe(false);
  });

  it("unlisted YouTube + published page = not public", () => {
    expect(isYouTubeVideoPagePublic(makeInput({ privacyStatus: "unlisted" }))).toBe(false);
  });

  it("private YouTube + published page = not public", () => {
    expect(isYouTubeVideoPagePublic(makeInput({ privacyStatus: "private" }))).toBe(false);
  });

  it("unavailable YouTube (not OBSERVED) + published page = not public", () => {
    expect(isYouTubeVideoPagePublic(makeInput({ observabilityState: "UNAVAILABLE" }))).toBe(false);
  });

  it("deleted YouTube (not OBSERVED) + published page = not public", () => {
    expect(isYouTubeVideoPagePublic(makeInput({ observabilityState: "DELETED" }))).toBe(false);
  });

  it("not observed in the most recent full sync pass + published page = not public", () => {
    expect(isYouTubeVideoPagePublic(makeInput({ observabilityState: "NOT_OBSERVED" }))).toBe(false);
  });

  it("archived page + otherwise-public + published = not public", () => {
    expect(isYouTubeVideoPagePublic(makeInput({ archivedAt: new Date() }))).toBe(false);
  });

  it("no page at all = not public", () => {
    expect(isYouTubeVideoPagePublic(makeInput({ noPage: true }))).toBe(false);
  });

  it("no linked YouTubeVideo at all = not public", () => {
    expect(isYouTubeVideoPagePublic({ page: { status: "PUBLISHED", archivedAt: null }, youtubeVideo: null })).toBe(false);
  });
});
