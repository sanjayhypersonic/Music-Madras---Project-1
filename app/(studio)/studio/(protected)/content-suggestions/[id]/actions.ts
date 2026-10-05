"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import {
  approveContentSuggestion,
  rejectContentSuggestion,
  requestContentSuggestionChanges,
  submitSuggestionForReview,
  type RejectSuggestionReason,
} from "../../../../../../modules/db/repositories/contentSuggestionRepository";
import { applyApprovedContentSuggestion } from "../../../../../../modules/db/repositories/contentSuggestionApplicationRepository";
import { describeApplyRefusalForEditor } from "../../../../../../modules/mmke/contentIntelligence/applyContentSuggestionRefusal";

// Phase 6H-4 — review actions for one ContentSuggestion. Every mutation is
// gated by EDITORIAL_REVIEW (docs/content-intelligence-architecture.md
// Phase 6H-2 §34: the same permission that already governs moving a
// Recording through its own review phases). None of these ever touch a
// canonical MMKE entity — see contentSuggestionRepository.ts's own header
// comment.

function errorRedirect(suggestionId: string, message: string): never {
  redirect(`/studio/content-suggestions/${suggestionId}?error=${encodeURIComponent(message)}`);
}

// Phase 6J-4: a transition refused by the lifecycle rules (a stale page, a double click, a second reviewer)
// is reported on the page, exactly as applyToRecordingDraftAction already does, instead of surfacing a raw
// error. The repository functions still enforce every rule; this only changes how a refusal is shown.
async function runTransition(suggestionId: string, message: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch {
    errorRedirect(suggestionId, message);
  }
}

export async function submitForReviewAction(suggestionId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "EDITORIAL_REVIEW")) {
    errorRedirect(suggestionId, "You do not have permission to move this suggestion into review.");
  }

  await runTransition(suggestionId, "This suggestion can no longer be moved into review (its status has changed).", () => submitSuggestionForReview(suggestionId, session!.user.id));
  redirect(`/studio/content-suggestions/${suggestionId}`);
}

export async function approveAction(suggestionId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "EDITORIAL_REVIEW")) {
    errorRedirect(suggestionId, "You do not have permission to approve this suggestion.");
  }

  const finalContent = String(formData.get("finalContent") ?? "").trim() || null;
  const reviewNote = String(formData.get("reviewNote") ?? "").trim() || null;

  await runTransition(suggestionId, "This suggestion cannot be approved from its current status. Reload the page to see where it stands.", () =>
    approveContentSuggestion(suggestionId, session!.user.id, { finalContent, reviewNote })
  );
  redirect(`/studio/content-suggestions/${suggestionId}`);
}

// Phase 6I-2 — applying an APPROVED suggestion edits a Recording draft, so it
// is gated by RECORDING_WRITE (the permission that already governs editing a
// Recording draft revision), NOT by EDITORIAL_REVIEW: approving wording and
// changing a Recording are separate concerns in this RBAC model. Never
// automatic on approval, never publishes, never calls an AI provider.
export async function applyToRecordingDraftAction(suggestionId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_WRITE")) {
    errorRedirect(suggestionId, "You do not have permission to edit this Recording's draft.");
  }

  let result: Awaited<ReturnType<typeof applyApprovedContentSuggestion>>;
  try {
    result = await applyApprovedContentSuggestion({ suggestionId, actorId: session!.user.id });
  } catch {
    errorRedirect(suggestionId, "The suggestion could not be applied. Nothing was changed. Please try again.");
  }

  if (!result.ok) {
    errorRedirect(suggestionId, describeApplyRefusalForEditor(result.reason));
  }

  redirect(`/studio/content-suggestions/${suggestionId}`);
}

export async function rejectAction(suggestionId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "EDITORIAL_REVIEW")) {
    errorRedirect(suggestionId, "You do not have permission to reject this suggestion.");
  }

  const reason = String(formData.get("reason") ?? "OTHER") as RejectSuggestionReason;
  const reviewNote = String(formData.get("reviewNote") ?? "").trim() || null;

  await runTransition(suggestionId, "This suggestion cannot be rejected from its current status. Reload the page to see where it stands.", () =>
    rejectContentSuggestion(suggestionId, session!.user.id, { reason, reviewNote })
  );
  redirect(`/studio/content-suggestions/${suggestionId}`);
}

export async function requestChangesAction(suggestionId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "EDITORIAL_REVIEW")) {
    errorRedirect(suggestionId, "You do not have permission to request changes to this suggestion.");
  }

  const reviewNote = String(formData.get("reviewNote") ?? "").trim();
  if (!reviewNote) {
    errorRedirect(suggestionId, "Explain what changes are needed before requesting them.");
  }

  await runTransition(suggestionId, "Changes cannot be requested from this suggestion's current status. Reload the page to see where it stands.", () =>
    requestContentSuggestionChanges(suggestionId, session!.user.id, reviewNote)
  );
  redirect(`/studio/content-suggestions/${suggestionId}`);
}
