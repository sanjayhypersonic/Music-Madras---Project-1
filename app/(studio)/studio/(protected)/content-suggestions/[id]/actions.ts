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

// Phase 6H-4 — review actions for one ContentSuggestion. Every mutation is
// gated by EDITORIAL_REVIEW (docs/content-intelligence-architecture.md
// Phase 6H-2 §34: the same permission that already governs moving a
// Recording through its own review phases). None of these ever touch a
// canonical MMKE entity — see contentSuggestionRepository.ts's own header
// comment.

function errorRedirect(suggestionId: string, message: string): never {
  redirect(`/studio/content-suggestions/${suggestionId}?error=${encodeURIComponent(message)}`);
}

export async function submitForReviewAction(suggestionId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "EDITORIAL_REVIEW")) {
    errorRedirect(suggestionId, "You do not have permission to move this suggestion into review.");
  }

  await submitSuggestionForReview(suggestionId, session!.user.id);
  redirect(`/studio/content-suggestions/${suggestionId}`);
}

export async function approveAction(suggestionId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "EDITORIAL_REVIEW")) {
    errorRedirect(suggestionId, "You do not have permission to approve this suggestion.");
  }

  const finalContent = String(formData.get("finalContent") ?? "").trim() || null;
  const reviewNote = String(formData.get("reviewNote") ?? "").trim() || null;

  await approveContentSuggestion(suggestionId, session!.user.id, { finalContent, reviewNote });
  redirect(`/studio/content-suggestions/${suggestionId}`);
}

export async function rejectAction(suggestionId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "EDITORIAL_REVIEW")) {
    errorRedirect(suggestionId, "You do not have permission to reject this suggestion.");
  }

  const reason = String(formData.get("reason") ?? "OTHER") as RejectSuggestionReason;
  const reviewNote = String(formData.get("reviewNote") ?? "").trim() || null;

  await rejectContentSuggestion(suggestionId, session!.user.id, { reason, reviewNote });
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

  await requestContentSuggestionChanges(suggestionId, session!.user.id, reviewNote);
  redirect(`/studio/content-suggestions/${suggestionId}`);
}
