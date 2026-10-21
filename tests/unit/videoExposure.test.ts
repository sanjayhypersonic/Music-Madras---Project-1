import { describe, expect, it } from "vitest";
import type { ObservabilityState } from "@prisma/client";
import { explainVideoExposure, isVideoExposed, type ActiveApproval, type ExposureHoldName, type ExposureSurface, type VideoExposureFacts } from "../../modules/mmke/catalogue/videoExposure";
import { isYouTubeVideoPagePublic } from "../../modules/mmke/catalogue/isYouTubeVideoPagePublic";

// Phase 6K-2 — the shared exposure rule, exhaustively. The expected value comes from an INDEPENDENT oracle written as a plain truth
// table in this file (a different shape from the implementation), over every combination of video visibility, availability, page
// state and approvals. Synthetic values only.

const PRIVACY = ["public", "unlisted", "private", null, "something-else"] as const;
const OBSERVABILITY: ObservabilityState[] = ["OBSERVED", "NOT_OBSERVED", "UNAVAILABLE"];
const PAGES = ["none", "draft", "published", "published-archived"] as const;
const HOLDS: (ExposureHoldName | null)[] = [null, "RIGHTS", "COPYRIGHT", "PRIVACY", "OTHER"];
const APPROVAL_SETS: Record<string, ActiveApproval[]> = {
  none: [],
  page: [{ scope: "PAGE", playlistPageId: null }],
  "page+discovery": [{ scope: "PAGE", playlistPageId: null }, { scope: "DISCOVERY", playlistPageId: null }],
  "page+playlistA": [{ scope: "PAGE", playlistPageId: "A" }, { scope: "PLAYLIST", playlistPageId: "A" }].map((a, i) => (i === 0 ? { scope: "PAGE" as const, playlistPageId: null } : (a as ActiveApproval))),
  "discovery-only": [{ scope: "DISCOVERY", playlistPageId: null }],
  "playlistA-only": [{ scope: "PLAYLIST", playlistPageId: "A" }],
  all: [{ scope: "PAGE", playlistPageId: null }, { scope: "DISCOVERY", playlistPageId: null }, { scope: "PLAYLIST", playlistPageId: "A" }],
};
const SURFACES: ExposureSurface[] = [{ kind: "PAGE" }, { kind: "DISCOVERY" }, { kind: "PLAYLIST", playlistPageId: "A" }, { kind: "PLAYLIST", playlistPageId: "B" }];

function build(pageKind: (typeof PAGES)[number], privacy: string | null, observed: ObservabilityState, approvalKey: string, flag: boolean, hold: ExposureHoldName | null = null): VideoExposureFacts {
  const page =
    pageKind === "none"
      ? null
      : { status: pageKind === "draft" ? ("DRAFT" as const) : ("PUBLISHED" as const), archivedAt: pageKind === "published-archived" ? new Date() : null, unlistedPublicationApprovedAt: flag ? new Date() : null };
  return { page, youtubeVideo: { privacyStatus: privacy, observabilityState: observed }, activeApprovals: APPROVAL_SETS[approvalKey], hold };
}

/** The specification as a truth table, written without reusing the implementation's structure. */
function oracle(f: VideoExposureFacts, s: ExposureSurface): boolean {
  if (f.hold !== null) return false; // an active hold denies every surface for every video
  const publishedPage = f.page !== null && f.page.status === "PUBLISHED" && f.page.archivedAt === null;
  const available = f.youtubeVideo?.observabilityState === "OBSERVED";
  if (!publishedPage || !available) return false;
  const has = (scope: string, pl: string | null = null) => f.activeApprovals.some((a) => a.scope === scope && (scope !== "PLAYLIST" || a.playlistPageId === pl));
  switch (f.youtubeVideo?.privacyStatus) {
    case "public":
      return true;
    case "unlisted": {
      const pageApproved = f.page!.unlistedPublicationApprovedAt !== null && has("PAGE");
      if (!pageApproved) return false;
      if (s.kind === "PAGE") return true;
      if (s.kind === "DISCOVERY") return has("DISCOVERY");
      return has("PLAYLIST", s.playlistPageId);
    }
    default:
      return false;
  }
}

describe("isVideoExposed — exhaustive truth table", () => {
  it("agrees with the specification for every combination", () => {
    let checked = 0;
    for (const pageKind of PAGES)
      for (const privacy of PRIVACY)
        for (const observed of OBSERVABILITY)
          for (const approvalKey of Object.keys(APPROVAL_SETS))
            for (const flag of [true, false])
              for (const hold of HOLDS)
                for (const surface of SURFACES) {
                  const facts = build(pageKind, privacy, observed, approvalKey, flag, hold);
                  expect(isVideoExposed(facts, surface), JSON.stringify({ pageKind, privacy, observed, approvalKey, flag, hold, surface })).toBe(oracle(facts, surface));
                  checked += 1;
                }
    expect(checked).toBe(PAGES.length * PRIVACY.length * OBSERVABILITY.length * Object.keys(APPROVAL_SETS).length * 2 * HOLDS.length * SURFACES.length);
  });

  it("PAGE exposure is exactly the existing single predicate for public videos and, for unlisted ones, the predicate AND a recorded approval", () => {
    for (const pageKind of PAGES)
      for (const privacy of PRIVACY)
        for (const observed of OBSERVABILITY)
          for (const flag of [true, false]) {
            const withApproval = build(pageKind, privacy, observed, "page", flag);
            const legacy = isYouTubeVideoPagePublic({ page: withApproval.page, youtubeVideo: withApproval.youtubeVideo });
            expect(isVideoExposed(withApproval, { kind: "PAGE" }), JSON.stringify({ pageKind, privacy, observed, flag })).toBe(legacy);
            if (privacy === "unlisted") expect(isVideoExposed(build(pageKind, privacy, observed, "none", flag), { kind: "PAGE" })).toBe(false); // the flag alone is not a recorded approval
          }
  });
});

describe("the distinct states the product requires", () => {
  const unlistedPublished = (approvals: string, flag = true) => build("published", "unlisted", "OBSERVED", approvals, flag);

  it("an unlisted video with an approved page is reachable but NOT listed until discovery is approved", () => {
    const facts = unlistedPublished("page");
    expect(isVideoExposed(facts, { kind: "PAGE" })).toBe(true);
    expect(isVideoExposed(facts, { kind: "DISCOVERY" })).toBe(false);
    expect(isVideoExposed(unlistedPublished("page+discovery"), { kind: "DISCOVERY" })).toBe(true);
  });

  it("playlist approval is per playlist page and never implies discovery or another playlist", () => {
    const facts = unlistedPublished("page+playlistA");
    expect(isVideoExposed(facts, { kind: "PLAYLIST", playlistPageId: "A" })).toBe(true);
    expect(isVideoExposed(facts, { kind: "PLAYLIST", playlistPageId: "B" })).toBe(false);
    expect(isVideoExposed(facts, { kind: "DISCOVERY" })).toBe(false);
  });

  it("an approval without the page approval exposes nothing (discovery or playlist alone is meaningless)", () => {
    for (const key of ["discovery-only", "playlistA-only"]) {
      const facts = unlistedPublished(key);
      for (const surface of SURFACES) expect(isVideoExposed(facts, surface), `${key} ${JSON.stringify(surface)}`).toBe(false);
    }
  });

  it("a private video can never be exposed, whatever approvals exist", () => {
    for (const surface of SURFACES) expect(isVideoExposed(build("published", "private", "OBSERVED", "all", true), surface)).toBe(false);
  });

  it("YouTube playlist membership is not an input: the function cannot be told about it", () => {
    expect(Object.keys(unlistedPublished("none"))).toEqual(["page", "youtubeVideo", "activeApprovals", "hold"]);
  });
});

describe("explainVideoExposure mirrors the rule and says why", () => {
  it("its verdicts equal isVideoExposed for PAGE and DISCOVERY across the whole matrix", () => {
    for (const pageKind of PAGES)
      for (const privacy of PRIVACY)
        for (const observed of OBSERVABILITY)
          for (const approvalKey of Object.keys(APPROVAL_SETS))
            for (const flag of [true, false]) {
              const facts = build(pageKind, privacy, observed, approvalKey, flag);
              const [page, discovery] = explainVideoExposure(facts);
              expect(page.allowed).toBe(isVideoExposed(facts, { kind: "PAGE" }));
              expect(discovery.allowed).toBe(isVideoExposed(facts, { kind: "DISCOVERY" }));
              expect(page.reason.length).toBeGreaterThan(5);
            }
  });

  it("names the missing step for an unlisted video", () => {
    expect(explainVideoExposure(build("published", "unlisted", "OBSERVED", "none", false))[0].reason).toMatch(/no recorded approval/);
    expect(explainVideoExposure(build("published", "unlisted", "OBSERVED", "page", true))[1].reason).toMatch(/no approval to be listed/);
    expect(explainVideoExposure(build("published", "private", "OBSERVED", "none", false))[0].reason).toMatch(/private/);
  });
});

describe("an active hold (rights, copyright, privacy) at the final shared check", () => {
  it("denies every surface for a PUBLIC video that would otherwise be shown everywhere", () => {
    const open = build("published", "public", "OBSERVED", "none", false);
    for (const surface of SURFACES) expect(isVideoExposed(open, surface)).toBe(true);
    for (const hold of HOLDS.filter((h): h is ExposureHoldName => h !== null)) {
      const held = build("published", "public", "OBSERVED", "none", false, hold);
      for (const surface of SURFACES) expect(isVideoExposed(held, surface), `${hold} ${JSON.stringify(surface)}`).toBe(false);
    }
  });

  it("denies every surface for a fully approved UNLISTED video, and a later hold-free state restores nothing by itself", () => {
    const approved = build("published", "unlisted", "OBSERVED", "all", true);
    for (const surface of SURFACES) expect(isVideoExposed(approved, surface)).toBe(surface.kind !== "PLAYLIST" || surface.playlistPageId === "A");
    for (const surface of SURFACES) expect(isVideoExposed({ ...approved, hold: "COPYRIGHT" }, surface)).toBe(false);
    // clearing the hold only removes the denial: with the approvals revoked (as the hold does) nothing is exposed
    for (const surface of SURFACES) expect(isVideoExposed(build("published", "unlisted", "OBSERVED", "none", false), surface)).toBe(false);
  });

  it("is explained to the editor as the reason", () => {
    const [page, discovery] = explainVideoExposure(build("published", "public", "OBSERVED", "none", false, "RIGHTS"));
    for (const line of [page, discovery]) {
      expect(line.allowed).toBe(false);
      expect(line.reason).toMatch(/rights hold is in place/i);
    }
  });
});