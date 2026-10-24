// The Studio "Recording public visibility" workspace — the PURE classification of one Recording (Prisma-free, no I/O; ADR §3 boundary rule).
//
// There is deliberately NO second definition of "public" here. The rules are the existing ones, called, not copied:
//   - a Recording's own public page / sitemap / archive search entry exists exactly when isRecordingPublished (status PUBLISHED and a published-revision pointer);
//   - what that page shows is read from the revision the pointer names, never from the open draft and never from the frozen legacy Recording-level rows
//     (this module is handed published-revision facts only; the workspace reads no Sources, Rights or Occasions at all);
//   - whether a video is shown is isVideoExposed on the DISCOVERY surface (the surface the Recording page, archive search and related-video sections use),
//     with explainVideoExposure's wording for the reason; a hold is the existing VideoExposureReview.holdReason;
//   - the "publish gate" blockers of an unpublished Recording are the existing REQUIRED completeness categories (isReadyToPublish).
//
// Four kinds of finding are kept apart, because they mean different things to an editor:
//   BLOCKER        the Recording is not public (or cannot be published) and this is why. Only the existing rules make something a blocker: status, the
//                  published-revision pointer, and the publish gate's REQUIRED categories (title, a work, a primary video).
//   DISCOVERY_GAP  the Recording IS public, but something that would help visitors find or understand it is absent: no work, no performance (and so no venue),
//                  no publicly shown video. The public page does not require any of these, so none is ever called a blocker for a public Recording.
//   RESTRICTION    an explicit rule or decision limits what visitors see: a Recording-level HOLD on the Recording itself (R-20), a hold on a linked video, or a
//                  video the platform's own visibility rule withholds (private, or unlisted without a recorded approval). Never inferred from a title or a keyword.
//                  A Recording hold withholds the whole Recording (bucket HELD) and is independent of any video hold: holding a video never holds its Recording.
//   NOT_DETERMINED the facts do not establish the answer (an inconsistent pointer, a missing fact, an unexpected error). Reported, never guessed.
//
// A Recording lands in exactly ONE bucket (so the counts add up). Gaps are an overlay on PUBLIC Recordings; restrictions are an overlay on any Recording that has
// one (a held Recording, or a public one with a restricted video); the two overlays can overlap each other.

import { isRecordingPublished } from "../catalogue/isRecordingPublished";
import { explainVideoExposure, isVideoExposed, type VideoExposureFacts } from "../catalogue/videoExposure";
import { checkRecordingRevisionCompleteness, listMissingRequiredCategories } from "../completeness/checkRecordingRevisionCompleteness";

export type RecordingStatusName = "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "ARCHIVED";

export type VisibilityBucket =
  /** Public page, sitemap and search entry exist (isRecordingPublished, and the pointer is consistent). */
  | "PUBLIC"
  /** A published revision is on record (or the status says published) but the Recording is not public: archived, unpublished, or marked published without a revision. */
  | "PUBLISHED_NOT_DISCOVERABLE"
  /** Published, but withheld by a Recording-level hold (R-20): not public until the hold is lifted. */
  | "HELD"
  /** Never published; still being prepared. */
  | "NOT_PUBLISHED_YET"
  /** The facts do not establish whether visitors can see it. */
  | "NOT_DETERMINED";

export type FindingKind = "BLOCKER" | "DISCOVERY_GAP" | "RESTRICTION" | "NOT_DETERMINED";

export type FindingCode =
  // blockers
  | "ARCHIVED"
  | "UNPUBLISHED"
  | "NOT_PUBLISHED_YET"
  | "NO_PUBLISHED_REVISION"
  | "NO_OPEN_DRAFT"
  | "PUBLISH_GATE_TITLE"
  | "PUBLISH_GATE_WORKS"
  | "PUBLISH_GATE_VIDEO"
  | "PUBLISH_GATE_OTHER"
  // discovery gaps
  | "NO_WORK"
  | "WORKS_NOT_PUBLIC"
  | "NO_PERFORMANCE"
  | "PERFORMANCE_NOT_PUBLIC"
  | "NO_VIDEO"
  | "VIDEO_PAGE_MISSING"
  | "VIDEO_PAGE_NOT_PUBLISHED"
  | "VIDEO_UNAVAILABLE"
  // explicit restrictions
  | "RECORDING_HOLD"
  | "VIDEO_HOLD"
  | "VIDEO_PRIVATE"
  | "VIDEO_UNLISTED_NOT_APPROVED"
  // not determined
  | "REVISION_POINTER_INCONSISTENT"
  | "VIDEO_FACTS_MISSING"
  | "VIDEO_UNEXPLAINED"
  | "UNEXPECTED_DATA";

/** Where the existing Studio edit route for a finding is. */
export type FixTarget = "SOURCE" | "WORKS" | "PERFORMANCE" | "MEDIA" | "REVIEW" | "RECORDING" | "VIDEO";

export interface Finding {
  kind: FindingKind;
  code: FindingCode;
  message: string;
  /** The existing Studio route to look at or change this, when one exists. */
  fix: { label: string; href: string } | null;
}

export interface PublishedRevisionFacts {
  id: string;
  recordingId: string;
  revisionStatus: "DRAFT" | "PUBLISHED" | "SUPERSEDED";
  title: string | null;
  /** One entry per linked work: `archived` when the work or its composer is archived (the public page omits those: isActiveWork). */
  works: ReadonlyArray<{ archived: boolean }>;
  /** Null when the revision has no performance. A venue is only ever attached through a performance. */
  performance: { archived: boolean; programmeArchived: boolean; venueArchived: boolean } | null;
  media: ReadonlyArray<{ provider: string; /** The internal YouTubeVideo.id, when this is a YouTube video. */ youtubeVideoId: string | null }>;
}

export interface DraftRevisionFacts {
  id: string;
  title: string | null;
  workCount: number;
  hasPerformance: boolean;
  hasPrimaryVideo: boolean;
}

export interface RecordingVisibilityFacts {
  id: string;
  slug: string;
  status: RecordingStatusName;
  currentPublishedRevisionId: string | null;
  currentDraftRevisionId: string | null;
  /** The revision the published pointer names, as loaded; null when there is no pointer (or the row could not be read). */
  published: PublishedRevisionFacts | null;
  /** The Recording-level hold, if any (R-20). Independent of every video hold. */
  hold: { reason: string; note: string | null; setAt: Date } | null;
  /** The open draft revision, if any. */
  draft: DraftRevisionFacts | null;
  /** Exposure facts of the YouTube videos on the PUBLISHED revision, keyed by YouTubeVideo.id. */
  videos: ReadonlyMap<string, VideoExposureFacts>;
}

export interface RecordingVisibility {
  bucket: VisibilityBucket;
  /** The revision title a visitor would see (published revision) or, for a Recording that is not public, the open draft's working title. */
  title: string | null;
  findings: Finding[];
  /** The Recording's public page. Present only when that page genuinely exists (bucket PUBLIC). */
  publicPath: string | null;
  hasGaps: boolean;
  hasRestrictions: boolean;
}

export const BUCKET_LABEL: Record<VisibilityBucket, string> = {
  PUBLIC: "Publicly discoverable",
  PUBLISHED_NOT_DISCOVERABLE: "Published, but not public",
  HELD: "On hold, withheld from the public",
  NOT_PUBLISHED_YET: "Not published yet",
  NOT_DETERMINED: "Not determined",
};

export const FINDING_KIND_LABEL: Record<FindingKind, string> = {
  BLOCKER: "Blocker",
  DISCOVERY_GAP: "Discovery gap",
  RESTRICTION: "Restriction",
  NOT_DETERMINED: "Not determined",
};

const FIX_SEGMENT: Record<Exclude<FixTarget, "VIDEO">, string> = {
  SOURCE: "source",
  WORKS: "works",
  PERFORMANCE: "performance",
  MEDIA: "media",
  REVIEW: "review",
  RECORDING: "source",
};

const FIX_LABEL: Record<FixTarget, string> = {
  SOURCE: "Open the recording",
  WORKS: "Open the Works step",
  PERFORMANCE: "Open the Performance step",
  MEDIA: "Open the Media step",
  REVIEW: "Open Review & Publish",
  RECORDING: "Open the recording",
  VIDEO: "Open the video's Studio page",
};

/** The existing Studio route for a target. Pure string building; a video target needs the internal YouTubeVideo id. */
export function fixLink(recordingId: string, target: FixTarget, youtubeVideoId?: string): { label: string; href: string } {
  if (target === "VIDEO") {
    return youtubeVideoId ? { label: FIX_LABEL.VIDEO, href: `/studio/catalogue/videos/${youtubeVideoId}` } : { label: FIX_LABEL.MEDIA, href: `/studio/recordings/${recordingId}/media` };
  }
  return { label: FIX_LABEL[target], href: `/studio/recordings/${recordingId}/${FIX_SEGMENT[target]}` };
}

const finding = (kind: FindingKind, code: FindingCode, message: string, fix: Finding["fix"] = null): Finding => ({ kind, code, message, fix });

const HOLD_WORDS: Record<string, string> = { RIGHTS: "rights", COPYRIGHT: "copyright", PRIVACY: "privacy", OTHER: "" };

const GATE_CODE: Record<string, { code: FindingCode; target: FixTarget }> = {
  Identity: { code: "PUBLISH_GATE_TITLE", target: "SOURCE" },
  "Musical Works": { code: "PUBLISH_GATE_WORKS", target: "WORKS" },
  Media: { code: "PUBLISH_GATE_VIDEO", target: "MEDIA" },
};

/** The video-level findings for a PUBLIC Recording. Gaps are only emitted when no linked video is publicly shown; restrictions always are. */
function videoFindings(facts: RecordingVisibilityFacts, published: PublishedRevisionFacts): Finding[] {
  const youtubeIds = [...new Set(published.media.filter((m) => m.provider === "YOUTUBE" && m.youtubeVideoId !== null).map((m) => m.youtubeVideoId as string))];
  if (youtubeIds.length === 0) {
    const other = published.media.length;
    return [
      finding(
        "DISCOVERY_GAP",
        "NO_VIDEO",
        `No YouTube video is attached to the published revision${other > 0 ? ` (${other} other media item${other === 1 ? " is" : "s are"} attached, but a Recording page shows YouTube videos only)` : ""}, so the page has no video and the archive search result has no thumbnail.`,
        fixLink(facts.id, "MEDIA")
      ),
    ];
  }

  const restrictions: Finding[] = [];
  const gaps: Finding[] = [];
  const unexplained: Finding[] = [];
  let shown = 0;
  for (const id of youtubeIds) {
    const exposure = facts.videos.get(id);
    if (!exposure) {
      unexplained.push(finding("NOT_DETERMINED", "VIDEO_FACTS_MISSING", "A linked video's visibility facts could not be read, so whether it is shown is not determined.", fixLink(facts.id, "MEDIA")));
      continue;
    }
    if (isVideoExposed(exposure, { kind: "DISCOVERY" })) {
      shown += 1;
      continue;
    }
    const why = explainVideoExposure(exposure)[1].reason;
    const link = fixLink(facts.id, "VIDEO", id);
    if (exposure.hold !== null) {
      const word = HOLD_WORDS[exposure.hold] ? `${HOLD_WORDS[exposure.hold]} ` : "";
      restrictions.push(finding("RESTRICTION", "VIDEO_HOLD", `A linked video is on an explicit ${word}hold, so it is not shown anywhere on the public Museum until a person clears the hold. Clearing a hold never approves anything: any approval it ended must be given again.`, link));
    } else if (!exposure.page) {
      gaps.push(finding("DISCOVERY_GAP", "VIDEO_PAGE_MISSING", `A linked video has no Music Madras page yet, so it is not shown. ${why}`, link));
    } else if (exposure.page.archivedAt !== null || exposure.page.status !== "PUBLISHED") {
      gaps.push(finding("DISCOVERY_GAP", "VIDEO_PAGE_NOT_PUBLISHED", `A linked video's page is not published (or is archived), so the video is not shown. ${why}`, link));
    } else if (!exposure.youtubeVideo || exposure.youtubeVideo.observabilityState !== "OBSERVED") {
      gaps.push(finding("DISCOVERY_GAP", "VIDEO_UNAVAILABLE", `A linked video is not currently available on YouTube, so it is not shown. ${why}`, link));
    } else if (exposure.youtubeVideo.privacyStatus === "private") {
      restrictions.push(finding("RESTRICTION", "VIDEO_PRIVATE", "A linked video is private on YouTube; the visibility rule never shows a private video publicly, and there is no approval that changes that.", link));
    } else if (exposure.youtubeVideo.privacyStatus === "unlisted") {
      restrictions.push(finding("RESTRICTION", "VIDEO_UNLISTED_NOT_APPROVED", `A linked video is unlisted on YouTube and is withheld until a person records the approvals the visibility rule requires. ${why}`, link));
    } else {
      unexplained.push(finding("NOT_DETERMINED", "VIDEO_UNEXPLAINED", "A linked video is not shown, but its recorded state does not say why (its YouTube privacy status is not one the rules know).", link));
    }
  }
  // If at least one video is publicly shown the Recording has a public video: its other videos are not a gap, but a hold or rule on them is still reported.
  return [...restrictions, ...(shown === 0 ? gaps : []), ...unexplained];
}

function publicFindings(facts: RecordingVisibilityFacts, published: PublishedRevisionFacts): Finding[] {
  const out: Finding[] = [];
  if (published.works.length === 0) {
    out.push(finding("DISCOVERY_GAP", "NO_WORK", "No musical work is linked to the published revision, so the Recording is not listed on any work or composer page.", fixLink(facts.id, "WORKS")));
  } else if (published.works.every((w) => w.archived)) {
    out.push(finding("DISCOVERY_GAP", "WORKS_NOT_PUBLIC", "Every linked work (or its composer) is archived, so the public page omits them and the Recording is not listed on a work or composer page.", fixLink(facts.id, "WORKS")));
  }
  const performance = published.performance;
  if (performance === null) {
    out.push(
      finding(
        "DISCOVERY_GAP",
        "NO_PERFORMANCE",
        "No performance is linked, so the Recording has no venue (a venue is attached through a performance), programme or participants and is not listed on a performance, programme or venue page.",
        fixLink(facts.id, "PERFORMANCE")
      )
    );
  } else if (performance.archived || performance.programmeArchived || performance.venueArchived) {
    const which = performance.archived ? "performance" : performance.venueArchived ? "venue" : "programme";
    out.push(
      finding(
        "DISCOVERY_GAP",
        "PERFORMANCE_NOT_PUBLIC",
        `The linked ${which} is archived, so the public page leaves out the whole performance block (performance, programme, venue and participants) and the Recording is not listed on those pages.`,
        fixLink(facts.id, "PERFORMANCE")
      )
    );
  }
  out.push(...videoFindings(facts, published));
  return out;
}

/** What stops an unpublished Recording from being published: the existing publish gate (REQUIRED completeness categories) over its open draft. */
function publishGateFindings(facts: RecordingVisibilityFacts): Finding[] {
  if (!facts.draft) {
    return [
      finding(
        "BLOCKER",
        "NO_OPEN_DRAFT",
        facts.currentPublishedRevisionId
          ? "There is no open draft to publish. Start a new draft from the last published revision first."
          : "There is no open draft to publish.",
        fixLink(facts.id, "RECORDING")
      ),
    ];
  }
  const draft = facts.draft;
  // Only the REQUIRED categories are used (the publish gate); the other inputs do not affect them.
  const report = checkRecordingRevisionCompleteness({
    title: draft.title,
    linkedWorkCount: draft.workCount,
    hasPerformance: draft.hasPerformance,
    hasVenue: draft.hasPerformance,
    participantCount: 0,
    hasPrimaryVideo: draft.hasPrimaryVideo,
    hasEducationalContent: false,
    hasSeoMetaTitle: false,
  });
  return listMissingRequiredCategories(report).map((item) => {
    const mapped = GATE_CODE[item.category] ?? { code: "PUBLISH_GATE_OTHER" as const, target: "REVIEW" as const };
    const detail = item.detail?.replace(/\.$/, "");
    return finding("BLOCKER", mapped.code, `Publishing is refused until this is provided (required by the publish gate, not by the public page): ${item.category}.${detail ? ` ${detail}.` : ""}`, fixLink(facts.id, mapped.target));
  });
}

function pointerProblem(facts: RecordingVisibilityFacts): string | null {
  const pointer = facts.currentPublishedRevisionId;
  if (pointer === null) return null;
  if (facts.published === null) return "The published-revision pointer names a revision that could not be read.";
  if (facts.published.id !== pointer) return "The published revision that was read is not the one the pointer names.";
  if (facts.published.recordingId !== facts.id) return "The published-revision pointer names a revision that belongs to a different recording.";
  if (facts.published.revisionStatus !== "PUBLISHED") return `The published-revision pointer names a revision marked ${facts.published.revisionStatus}, not PUBLISHED.`;
  return null;
}

function result(facts: RecordingVisibilityFacts, bucket: VisibilityBucket, findings: Finding[], title: string | null): RecordingVisibility {
  return {
    bucket,
    title,
    findings,
    publicPath: bucket === "PUBLIC" ? `/recordings/${facts.slug}` : null,
    hasGaps: bucket === "PUBLIC" && findings.some((f) => f.kind === "DISCOVERY_GAP"),
    hasRestrictions: findings.some((f) => f.kind === "RESTRICTION"),
  };
}

function classifyPublication(facts: RecordingVisibilityFacts): RecordingVisibility {
  const workingTitle = facts.draft?.title ?? facts.published?.title ?? null;

  if (facts.status === "PUBLISHED") {
    if (facts.currentPublishedRevisionId === null) {
      return result(
        facts,
        "PUBLISHED_NOT_DISCOVERABLE",
        [finding("BLOCKER", "NO_PUBLISHED_REVISION", "Marked published, but it has no published revision, so the public page, search and sitemap all leave it out (a Recording is public only with both).", fixLink(facts.id, "REVIEW"))],
        workingTitle
      );
    }
    const problem = pointerProblem(facts);
    if (problem !== null || facts.published === null) {
      return result(
        facts,
        "NOT_DETERMINED",
        [finding("NOT_DETERMINED", "REVISION_POINTER_INCONSISTENT", `${problem ?? "The published revision could not be read."} Whether visitors see this Recording is not determined until the data is reviewed.`, fixLink(facts.id, "REVIEW"))],
        workingTitle
      );
    }
    // isRecordingPublished is the single rule for "public"; reached here it is true by construction, so guard rather than assume.
    if (!isRecordingPublished({ status: facts.status, currentPublishedRevisionId: facts.currentPublishedRevisionId })) {
      return result(facts, "NOT_DETERMINED", [finding("NOT_DETERMINED", "UNEXPECTED_DATA", "The publication state could not be established.")], workingTitle);
    }
    const findings = publicFindings(facts, facts.published);
    const undetermined = findings.some((f) => f.kind === "NOT_DETERMINED");
    // The title a visitor sees is the PUBLISHED revision's, never the open draft's.
    return result(facts, undetermined ? "NOT_DETERMINED" : "PUBLIC", findings, facts.published.title);
  }

  const wasPublished = facts.currentPublishedRevisionId !== null;
  const bucket: VisibilityBucket = wasPublished ? "PUBLISHED_NOT_DISCOVERABLE" : "NOT_PUBLISHED_YET";
  if (facts.status === "ARCHIVED") {
    return result(facts, bucket, [finding("BLOCKER", "ARCHIVED", "Archived: an archived Recording is never public. Restore it to make it publishable again.", fixLink(facts.id, "RECORDING"))], workingTitle);
  }
  const statusBlocker = wasPublished
    ? finding("BLOCKER", "UNPUBLISHED", `Not public: its status is ${facts.status}. An earlier revision was published, but the public page, search and sitemap serve a Recording only while it is PUBLISHED.`, fixLink(facts.id, "REVIEW"))
    : finding("BLOCKER", "NOT_PUBLISHED_YET", `Not published yet (status ${facts.status}).`, fixLink(facts.id, "REVIEW"));
  return result(facts, bucket, [statusBlocker, ...publishGateFindings(facts)], workingTitle);
}

/** The finding for a Recording-level hold. `alsoUnpublished`: the Recording is not public for another reason today, and the hold will keep it off the Museum even after that changes. */
function holdFinding(facts: RecordingVisibilityFacts, hold: NonNullable<RecordingVisibilityFacts["hold"]>, alsoUnpublished: boolean): Finding {
  const since = hold.setAt.toISOString().slice(0, 10);
  const note = hold.note ? ` Note: ${hold.note}` : "";
  const message = alsoUnpublished
    ? `A Recording hold (${hold.reason.toLowerCase()}, recorded ${since}) is also in place. It will keep this recording off the public Museum even once it is published, until a person lifts it.${note}`
    : `On hold (${hold.reason.toLowerCase()}, recorded ${since}): this recording is published but withheld from every public page, search and the sitemap until a person lifts the hold. Its publication state and revisions are unchanged, and its videos are not affected.${note}`;
  return finding("RESTRICTION", "RECORDING_HOLD", message, fixLink(facts.id, "REVIEW"));
}

function classify(facts: RecordingVisibilityFacts): RecordingVisibility {
  const hold = facts.hold;
  if (hold === null) return classifyPublication(facts);

  // A held Recording is withheld whatever else is true. If it is PUBLISHED (status and a published pointer) the hold is what keeps it off the Museum: its own
  // bucket, with no gap or video analysis (nothing of it is public to be analysed). Otherwise it is not public for another reason and keeps that bucket,
  // with the hold added as a restriction (so lifting it later cannot surprise anyone by exposing a recording that was meant to stay hidden).
  const base = classifyPublication(facts);
  if (facts.status === "PUBLISHED" && facts.currentPublishedRevisionId !== null) {
    const findings: Finding[] = [holdFinding(facts, hold, false)];
    const problem = pointerProblem(facts);
    if (problem !== null) findings.push(finding("NOT_DETERMINED", "REVISION_POINTER_INCONSISTENT", `${problem} This is reported for review; the hold withholds the recording either way.`, fixLink(facts.id, "REVIEW")));
    return result(facts, "HELD", findings, facts.published?.title ?? facts.draft?.title ?? null);
  }
  return result(facts, base.bucket, [...base.findings, holdFinding(facts, hold, true)], base.title);
}
/** Classifies one Recording. Never throws: unexpected data yields NOT_DETERMINED rather than taking the whole workspace down. */
export function classifyRecordingVisibility(facts: RecordingVisibilityFacts): RecordingVisibility {
  try {
    return classify(facts);
  } catch {
    return {
      bucket: "NOT_DETERMINED",
      title: null,
      findings: [finding("NOT_DETERMINED", "UNEXPECTED_DATA", "This Recording's data could not be interpreted, so its visibility is not determined.", fixLink(facts.id, "RECORDING"))],
      publicPath: null,
      hasGaps: false,
      hasRestrictions: false,
    };
  }
}

export type VisibilityView = "public" | "not-discoverable" | "gaps" | "restricted" | "undetermined" | "unpublished" | "held";

export const VISIBILITY_VIEWS: readonly VisibilityView[] = ["public", "not-discoverable", "gaps", "restricted", "undetermined", "unpublished", "held"];

export function parseVisibilityView(value: string | undefined): VisibilityView {
  return VISIBILITY_VIEWS.find((v) => v === value) ?? "public";
}

/** Which view a classified Recording belongs to. A Recording with gaps AND restrictions is in both views (they are overlays; a held Recording is in "held" and "restricted"). */
export function inView(view: VisibilityView, r: RecordingVisibility): boolean {
  switch (view) {
    case "public":
      return r.bucket === "PUBLIC";
    case "not-discoverable":
      return r.bucket === "PUBLISHED_NOT_DISCOVERABLE";
    case "gaps":
      return r.hasGaps;
    case "restricted":
      return r.hasRestrictions;
    case "undetermined":
      return r.bucket === "NOT_DETERMINED";
    case "unpublished":
      return r.bucket === "NOT_PUBLISHED_YET";
    case "held":
      return r.bucket === "HELD";
  }
}

export interface VisibilityCounts {
  /** Recordings counted (the five buckets add up to this). */
  counted: number;
  public: number;
  notDiscoverable: number;
  held: number;
  unpublished: number;
  undetermined: number;
  /** Overlay on `public`: a subset of it. */
  withGaps: number;
  /** Overlay on every bucket: any Recording with an explicit restriction (held, or public with a restricted video, or not public with a hold waiting). */
  withRestrictions: number;
}

export function countVisibility(results: readonly RecordingVisibility[]): VisibilityCounts {
  const counts: VisibilityCounts = { counted: results.length, public: 0, notDiscoverable: 0, held: 0, unpublished: 0, undetermined: 0, withGaps: 0, withRestrictions: 0 };
  for (const r of results) {
    if (r.bucket === "PUBLIC") counts.public += 1;
    else if (r.bucket === "PUBLISHED_NOT_DISCOVERABLE") counts.notDiscoverable += 1;
    else if (r.bucket === "HELD") counts.held += 1;
    else if (r.bucket === "NOT_PUBLISHED_YET") counts.unpublished += 1;
    else counts.undetermined += 1;
    if (r.hasGaps) counts.withGaps += 1;
    if (r.hasRestrictions) counts.withRestrictions += 1;
  }
  return counts;
}
