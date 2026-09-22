import { describe, expect, it } from "vitest";
import { isYouTubeVideoPagePublic } from "../../modules/mmke/catalogue/isYouTubeVideoPagePublic";
import type { ObservabilityState } from "@prisma/client";

function makeInput(overrides: {
  status?: "DRAFT" | "PUBLISHED";
  archivedAt?: Date | null;
  unlistedPublicationApprovedAt?: Date | null;
  privacyStatus?: string | null;
  observabilityState?: ObservabilityState;
  noPage?: boolean;
}) {
  return {
    page: overrides.noPage
      ? null
      : {
          status: overrides.status ?? "PUBLISHED",
          archivedAt: overrides.archivedAt ?? null,
          unlistedPublicationApprovedAt: overrides.unlistedPublicationApprovedAt ?? null,
        },
    youtubeVideo: {
      privacyStatus: overrides.privacyStatus !== undefined ? overrides.privacyStatus : "public",
      observabilityState: overrides.observabilityState ?? "OBSERVED",
    },
  };
}

describe("isYouTubeVideoPagePublic", () => {
  it("A: public + published = public", () => {
    expect(isYouTubeVideoPagePublic(makeInput({}))).toBe(true);
  });

  it("B: public + draft = not public", () => {
    expect(isYouTubeVideoPagePublic(makeInput({ status: "DRAFT" }))).toBe(false);
  });

  it("C: unlisted + published + no approval = not public", () => {
    expect(isYouTubeVideoPagePublic(makeInput({ privacyStatus: "unlisted" }))).toBe(false);
  });

  it("D: unlisted + published + approval = public", () => {
    expect(isYouTubeVideoPagePublic(makeInput({ privacyStatus: "unlisted", unlistedPublicationApprovedAt: new Date() }))).toBe(true);
  });

  it("E: unlisted + draft + approval = not public (status still gates first)", () => {
    expect(
      isYouTubeVideoPagePublic(makeInput({ status: "DRAFT", privacyStatus: "unlisted", unlistedPublicationApprovedAt: new Date() }))
    ).toBe(false);
  });

  it("F: private + published + approval field somehow populated = not public (private has no approval path at all)", () => {
    expect(
      isYouTubeVideoPagePublic(makeInput({ privacyStatus: "private", unlistedPublicationApprovedAt: new Date() }))
    ).toBe(false);
  });

  it("G: archived + approval = not public", () => {
    expect(
      isYouTubeVideoPagePublic(
        makeInput({ archivedAt: new Date(), privacyStatus: "unlisted", unlistedPublicationApprovedAt: new Date() })
      )
    ).toBe(false);
  });

  it("private + published, no approval = not public (baseline, no approval field involved)", () => {
    expect(isYouTubeVideoPagePublic(makeInput({ privacyStatus: "private" }))).toBe(false);
  });

  it("unavailable YouTube (not OBSERVED) + published = not public, even if somehow approved", () => {
    expect(
      isYouTubeVideoPagePublic(
        makeInput({ observabilityState: "UNAVAILABLE", privacyStatus: "unlisted", unlistedPublicationApprovedAt: new Date() })
      )
    ).toBe(false);
  });

  it("deleted YouTube (not OBSERVED) + published = not public", () => {
    expect(isYouTubeVideoPagePublic(makeInput({ observabilityState: "DELETED" }))).toBe(false);
  });

  it("not observed in the most recent full sync pass + published = not public", () => {
    expect(isYouTubeVideoPagePublic(makeInput({ observabilityState: "NOT_OBSERVED" }))).toBe(false);
  });

  it("an absent/unknown privacyStatus is never public, approval or not", () => {
    expect(isYouTubeVideoPagePublic(makeInput({ privacyStatus: null, unlistedPublicationApprovedAt: new Date() }))).toBe(false);
  });

  it("no page at all = not public", () => {
    expect(isYouTubeVideoPagePublic(makeInput({ noPage: true }))).toBe(false);
  });

  it("no linked YouTubeVideo at all = not public", () => {
    expect(
      isYouTubeVideoPagePublic({
        page: { status: "PUBLISHED", archivedAt: null, unlistedPublicationApprovedAt: null },
        youtubeVideo: null,
      })
    ).toBe(false);
  });
});
