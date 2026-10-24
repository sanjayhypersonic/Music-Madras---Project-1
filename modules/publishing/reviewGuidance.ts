import type { CompletenessReportItem } from "../mmke/completeness/checkRecordingRevisionCompleteness";

// Review & Publish GUIDANCE (launch workflow): for the signed-in person, on this recording in this state, what blocks publication and where to fix it, and which
// lifecycle actions they can take, which they cannot, and who can. PURE: no database, no framework, no permission lookup of its own. It is handed the viewer's
// capabilities (computed server-side from the role policy by the page) and describes them; it never grants anything. The server actions re-check every permission.
//
// What counts as a blocker is NOT decided here: it is the existing publish gate, i.e. the REQUIRED completeness categories that are MISSING
// (checkRecordingRevisionCompleteness / isReadyToPublish). RECOMMENDED categories are suggestions and are never called blockers.

export type RecordingStatusName = "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "ARCHIVED";

export interface Capabilities {
  /** May edit the recording's draft (RECORDING_WRITE). */
  canEdit: boolean;
  /** May submit a draft for editorial review (EDITORIAL_REVIEW). */
  canSubmitForReview: boolean;
  /** May publish, unpublish, archive, restore and hold (RECORDING_PUBLISH). */
  canPublish: boolean;
}

export interface WhoCan {
  /** "Editors, Reviewers, Administrators, ..." derived from the policy. */
  review: string;
  publish: string;
}

export interface GuidanceInput {
  status: RecordingStatusName;
  hasOpenDraft: boolean;
  hasPublishedRevision: boolean;
  /** The open draft's (or, with no draft, the published revision's) completeness report. Null when there is no revision to review. */
  report: readonly CompletenessReportItem[] | null;
  held: boolean;
  viewer: Capabilities;
  whoCan: WhoCan;
}

/** The Studio step where each completeness category is fixed (the existing step slugs). */
export const CATEGORY_STEP: Record<string, { slug: string; label: string }> = {
  Identity: { slug: "source", label: "Source" },
  "Musical Works": { slug: "works", label: "Composer / Works" },
  Media: { slug: "media", label: "Media Assets" },
  Performance: { slug: "performance", label: "Performance" },
  Venue: { slug: "venue", label: "Venue" },
  Performers: { slug: "participants", label: "Participants" },
  SEO: { slug: "seo", label: "SEO" },
  "Educational Content": { slug: "educational", label: "Educational Content" },
};

const FIX_MESSAGE: Record<string, string> = {
  Identity: "Give the recording its own Music Madras title.",
  "Musical Works": "Link at least one musical work.",
  Media: "Attach a primary video.",
  Performance: "Link the performance this recording documents.",
  Venue: "Choose the venue.",
  Performers: "Add the participants of the performance.",
  SEO: "Add a meta title for the public page.",
  "Educational Content": "Add a listening guide or analysis.",
};

export interface GuidanceItem {
  category: string;
  message: string;
  step: { slug: string; label: string } | null;
}

export type ActionKey = "SUBMIT_FOR_REVIEW" | "PUBLISH" | "UNPUBLISH" | "ARCHIVE" | "RESTORE";

export interface ActionGuidance {
  key: ActionKey;
  label: string;
  state: "AVAILABLE" | "BLOCKED" | "NEEDS_PERMISSION";
  /** One sentence, always present: why it is available, blocked, or who can do it. */
  reason: string;
}

export interface ReviewGuidance {
  /** One sentence: where the recording stands and what happens next. */
  summary: string;
  /** REQUIRED categories still missing: these stop publication. Empty when the gate is met. */
  blockers: GuidanceItem[];
  /** RECOMMENDED categories still missing: worth doing, never blocking. */
  suggestions: GuidanceItem[];
  actions: ActionGuidance[];
}

const item = (category: string, byMessage = FIX_MESSAGE): GuidanceItem => ({ category, message: byMessage[category] ?? `Complete ${category}.`, step: CATEGORY_STEP[category] ?? null });

export function describeReviewGuidance(input: GuidanceInput): ReviewGuidance {
  const missing = (level: CompletenessReportItem["level"]) => (input.report ?? []).filter((r) => r.level === level && r.status === "MISSING").map((r) => item(r.category));
  const blockers = input.hasOpenDraft ? missing("REQUIRED") : [];
  const suggestions = input.hasOpenDraft ? missing("RECOMMENDED") : [];
  const { status, viewer, whoCan } = input;
  const actions: ActionGuidance[] = [];

  if (status === "DRAFT" && input.hasOpenDraft) {
    actions.push(
      viewer.canSubmitForReview
        ? { key: "SUBMIT_FOR_REVIEW", label: "Submit for editorial review", state: "AVAILABLE", reason: "Moves the draft to review so an editor can check it. Nothing becomes public." }
        : { key: "SUBMIT_FOR_REVIEW", label: "Submit for editorial review", state: "NEEDS_PERMISSION", reason: `Only ${whoCan.review} can submit a draft for review.` }
    );
  }

  if (input.hasOpenDraft && status !== "ARCHIVED") {
    if (blockers.length > 0) {
      actions.push({ key: "PUBLISH", label: "Publish", state: "BLOCKED", reason: `Blocked until ${blockers.map((b) => b.category).join(" and ")} ${blockers.length === 1 ? "is" : "are"} provided (required before publishing).` });
    } else if (!viewer.canPublish) {
      actions.push({ key: "PUBLISH", label: "Publish", state: "NEEDS_PERMISSION", reason: `The draft meets the publishing requirements. Only ${whoCan.publish} can publish it.` });
    } else {
      actions.push({
        key: "PUBLISH",
        label: "Publish",
        state: "AVAILABLE",
        reason: input.held
          ? "The draft meets the publishing requirements. The recording is on hold, so publishing will not make it public until the hold is lifted."
          : "The draft meets the publishing requirements. Publishing makes it the version visitors see.",
      });
    }
  }

  if (status === "PUBLISHED") {
    actions.push(
      viewer.canPublish
        ? { key: "UNPUBLISH", label: "Unpublish", state: "AVAILABLE", reason: input.held ? "Takes the recording out of publication. It is already withheld by a hold." : "Removes the recording from the public Museum at once; its history is kept." }
        : { key: "UNPUBLISH", label: "Unpublish", state: "NEEDS_PERMISSION", reason: `Only ${whoCan.publish} can unpublish a recording.` }
    );
  }
  if (status !== "ARCHIVED") {
    actions.push(
      viewer.canPublish
        ? { key: "ARCHIVE", label: "Archive", state: "AVAILABLE", reason: "Removes the recording from the public Museum; it can be restored later." }
        : { key: "ARCHIVE", label: "Archive", state: "NEEDS_PERMISSION", reason: `Only ${whoCan.publish} can archive a recording.` }
    );
  } else {
    actions.push(
      viewer.canPublish
        ? { key: "RESTORE", label: "Restore to draft", state: "AVAILABLE", reason: "Returns the recording to Draft. It stays off the public Museum until it is published again." }
        : { key: "RESTORE", label: "Restore to draft", state: "NEEDS_PERMISSION", reason: `Only ${whoCan.publish} can restore an archived recording.` }
    );
  }

  return { summary: summarise(input, blockers.length), blockers, suggestions, actions };
}

function summarise(input: GuidanceInput, blockerCount: number): string {
  const { status, hasOpenDraft, hasPublishedRevision, held } = input;
  const holdNote = held ? " It is on hold, so it is withheld from the public Museum whatever its status." : "";
  if (status === "ARCHIVED") return `This recording is archived and not public.${holdNote} It has to be restored before it can be edited or published.`;
  if (!hasOpenDraft) {
    return status === "PUBLISHED"
      ? `This recording is published and has no pending changes.${holdNote} Start a new draft to change it; the published version stays as it is until a new draft is published.`
      : `This recording is not public and has no open draft.${holdNote} Start a new draft from its last published version to publish it again.`;
  }
  const base = status === "IN_REVIEW" ? "This draft is in editorial review." : hasPublishedRevision ? "This recording has a draft with changes that are not public yet." : "This recording is a draft that has never been published.";
  const gate = blockerCount > 0 ? ` It cannot be published yet: ${blockerCount} required ${blockerCount === 1 ? "item is" : "items are"} missing.` : " It meets the publishing requirements.";
  return `${base}${gate}${holdNote}`;
}
