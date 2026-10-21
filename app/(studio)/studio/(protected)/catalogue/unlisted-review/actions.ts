"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { confirmCarriedOverApprovals } from "../../../../../../modules/db/repositories/carriedOverApprovalsRepository";
import { clearReviewHold, decideReview, setReviewHold, type ReviewDecision } from "../../../../../../modules/db/repositories/unlistedReviewRepository";
import { revokeExposure } from "../../../../../../modules/db/repositories/videoExposureRepository";
import { acknowledgeMetadataChange } from "../../../../../../modules/db/repositories/videoMetadataReviewRepository";
import type { VideoExposureHold } from "@prisma/client";

// Phase 6K-2 — Server Actions for the unlisted-video review queue. Every decision changes (or declines to change) what visitors may
// see, so each one re-checks the session and RECORDING_PUBLISH itself. A decision names the fingerprint the reviewer was shown, so a
// video that changed in the meantime is refused rather than approved blind. Nothing here touches YouTube.

const BASE = "/studio/catalogue/unlisted-review";

function back(message: string, kind: "error" | "notice" = "error"): never {
  redirect(`${BASE}?${kind}=${encodeURIComponent(message)}`);
}

async function requirePublisher() {
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE" || !can(session.user.role, "RECORDING_PUBLISH")) back("You do not have permission to decide on unlisted videos.");
  return session!.user;
}

const HOLDS: readonly VideoExposureHold[] = ["RIGHTS", "COPYRIGHT", "PRIVACY", "OTHER"];

function parseDecision(formData: FormData): ReviewDecision {
  const kind = String(formData.get("decision") ?? "");
  switch (kind) {
    case "APPROVE_PAGE":
      return { kind: "APPROVE", scopes: ["PAGE"], playlistPageIds: formData.getAll("playlist").map(String).filter(Boolean) };
    case "APPROVE_PAGE_AND_LISTING":
      return { kind: "APPROVE", scopes: ["PAGE", "DISCOVERY"], playlistPageIds: formData.getAll("playlist").map(String).filter(Boolean) };
    case "REQUEST_INFO":
      return { kind: "REQUEST_INFO", infoRequest: String(formData.get("note") ?? "") };
    case "DEFER": {
      const raw = String(formData.get("until") ?? "").trim();
      const until = raw ? new Date(`${raw}T00:00:00.000Z`) : undefined;
      if (until && Number.isNaN(until.getTime())) back("That deferral date is not valid.");
      return { kind: "DEFER", until };
    }
    case "DECLINE":
      return { kind: "DECLINE" };
    case "REVOKE":
      return { kind: "REVOKE" };
    default:
      return back("Choose a decision.");
  }
}

export async function decideReviewAction(formData: FormData) {
  const user = await requirePublisher();
  const videoId = String(formData.get("videoId") ?? "");
  const fingerprint = String(formData.get("fingerprint") ?? "");
  if (!videoId || !fingerprint) back("That review request was incomplete.");
  const decision = parseDecision(formData);
  try {
    await decideReview({ videoId, expectedFingerprint: fingerprint, decision, actorId: user.id, note: String(formData.get("note") ?? "") || null });
  } catch (err) {
    back(err instanceof Error ? err.message : "The decision could not be recorded.");
  }
  back("Decision recorded.", "notice");
}

export async function setHoldAction(formData: FormData) {
  const user = await requirePublisher();
  const videoId = String(formData.get("videoId") ?? "");
  const hold = String(formData.get("hold") ?? "") as VideoExposureHold;
  if (!videoId || !HOLDS.includes(hold)) back("Choose the kind of hold.");
  try {
    await setReviewHold({ videoId, hold, note: String(formData.get("note") ?? "") || null, actorId: user.id });
  } catch (err) {
    back(err instanceof Error ? err.message : "The hold could not be recorded.");
  }
  back("Hold recorded. The video is no longer public.", "notice");
}

export async function clearHoldAction(formData: FormData) {
  const user = await requirePublisher();
  const videoId = String(formData.get("videoId") ?? "");
  if (!videoId) back("That request was incomplete.");
  try {
    await clearReviewHold({ videoId, actorId: user.id });
  } catch (err) {
    back(err instanceof Error ? err.message : "The hold could not be cleared.");
  }
  back("Hold cleared. Nothing was approved by clearing it. An unlisted video returns to the queue and needs a fresh approval; a public video whose page is published is visible again.", "notice");
}

// Phase 6K fix (F2) — reconsidering approvals that were carried over from the old single approval. Keeping one records who looked; withdrawing is
// the ordinary revocation (listing only, or the whole page and everything with it). All need RECORDING_PUBLISH, like every change to what visitors see.
export async function confirmCarriedOverAction(formData: FormData) {
  const user = await requirePublisher();
  const videoPageId = String(formData.get("videoPageId") ?? "");
  if (!videoPageId) back("That request was incomplete.");
  let confirmed = 0;
  try {
    confirmed = (await confirmCarriedOverApprovals({ videoPageId, actorId: user.id })).confirmed;
  } catch (err) {
    back(err instanceof Error ? err.message : "The approval could not be confirmed.");
  }
  back(confirmed > 0 ? "Kept. It is recorded that you reconsidered this approval." : "There was nothing waiting to be confirmed for that video.", "notice");
}

// Lifecycle hardening (F12) — an editor has looked at the changed metadata of an approved page and accepts it. The page stayed public throughout.
export async function acknowledgeMetadataAction(formData: FormData) {
  const user = await requirePublisher();
  const videoPageId = String(formData.get("videoPageId") ?? "");
  if (!videoPageId) back("That request was incomplete.");
  let acknowledged = false;
  try {
    acknowledged = (await acknowledgeMetadataChange({ videoPageId, actorId: user.id, note: String(formData.get("note") ?? "") || null })).acknowledged;
  } catch (err) {
    back(err instanceof Error ? err.message : "The metadata review could not be recorded.");
  }
  back(acknowledged ? "Recorded: you reviewed the changed metadata. The page stays public." : "There was no metadata change waiting for review on that page.", "notice");
}

export async function withdrawCarriedOverAction(formData: FormData) {
  const user = await requirePublisher();
  const videoPageId = String(formData.get("videoPageId") ?? "");
  const scope = String(formData.get("scope") ?? "");
  if (!videoPageId || (scope !== "DISCOVERY" && scope !== "PAGE")) back("That request was incomplete.");
  try {
    await revokeExposure({ videoPageId, scope: scope as "DISCOVERY" | "PAGE", actorId: user.id, note: "Reconsidered: the carried-over approval was withdrawn." });
  } catch (err) {
    back(err instanceof Error ? err.message : "The approval could not be withdrawn.");
  }
  back(scope === "PAGE" ? "Withdrawn: the page and its listing are no longer public. YouTube is unchanged." : "No longer listed. The page is still reachable by its link.", "notice");
}