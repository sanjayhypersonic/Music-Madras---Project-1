"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import {
  approveUnlistedPublication,
  archiveVideoPage,
  createDraftVideoPage,
  publishVideoPage,
  revokeUnlistedApproval,
  unarchiveVideoPage,
  unpublishVideoPage,
  updateEditorialFields,
} from "../../../../../../../modules/db/repositories/youtubeVideoPageRepository";
import { approveExposure, revokeExposure } from "../../../../../../../modules/db/repositories/videoExposureRepository";
import { acknowledgeMetadataChange } from "../../../../../../../modules/db/repositories/videoMetadataReviewRepository";
import { createRecordingFromYouTubeVideo } from "../../../../../../../modules/db/repositories/recordingIntakeRepository";
import { clearReviewHold, setReviewHold } from "../../../../../../../modules/db/repositories/unlistedReviewRepository";
import type { VideoExposureHold } from "@prisma/client";

// Phase 6G-1C — Server Actions for the per-video Studio manage page
// (brief "STUDIO ROUTE 2"). Every action re-checks the session and
// CATALOGUE_WRITE permission itself (Server Actions are callable
// independently of the page that rendered them), then calls straight
// into the existing 6G-1B repository — no database logic lives here, and
// none of these functions ever touches YouTubeVideo.

function errorRedirect(videoId: string, message: string): never {
  redirect(`/studio/catalogue/videos/${videoId}?error=${encodeURIComponent(message)}`);
}

export async function createCataloguePageAction(videoId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(videoId, "You do not have permission to create a catalogue page.");
  }

  try {
    await createDraftVideoPage({ youtubeVideoId: videoId, actorId: session!.user.id });
  } catch (err) {
    errorRedirect(videoId, err instanceof Error ? err.message : "Could not create the catalogue page.");
  }

  redirect(`/studio/catalogue/videos/${videoId}`);
}

// Phase 6I-1 — the one explicit entry point that turns a synced YouTube video
// into a canonical DRAFT Recording. Gated by RECORDING_WRITE (the same
// permission /studio/recordings already requires to start a draft) — no new
// permission. Never automatic, never bulk, never AI-assisted: one video, one
// editor click. Creates nothing but the Recording, its first draft revision,
// and the linked PRIMARY_VIDEO MediaResource.
export async function createRecordingFromVideoAction(videoId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_WRITE")) {
    errorRedirect(videoId, "You do not have permission to create a Recording.");
  }

  let result: Awaited<ReturnType<typeof createRecordingFromYouTubeVideo>>;
  try {
    result = await createRecordingFromYouTubeVideo({ youtubeVideoId: videoId, actorId: session!.user.id });
  } catch {
    errorRedirect(videoId, "The Recording could not be created. Please try again.");
  }

  if (!result.ok) {
    switch (result.reason) {
      case "ALREADY_LINKED":
        errorRedirect(videoId, "This YouTube video is already linked to a Music Madras Recording.");
      case "VIDEO_NOT_AVAILABLE":
        errorRedirect(videoId, "This YouTube video is not currently available in the synchronized catalogue, so a Recording cannot be created from it.");
      default:
        errorRedirect(videoId, "This YouTube video could not be found.");
    }
  }

  redirect(`/studio/recordings/${result.recording.id}/media`);
}

export async function updateEditorialFieldsAction(videoId: string, pageId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(videoId, "You do not have permission to edit this catalogue page.");
  }

  await updateEditorialFields(pageId, {
    curatorNote: String(formData.get("curatorNote") ?? "") || null,
    seoMetaTitle: String(formData.get("seoMetaTitle") ?? "") || null,
    seoMetaDescription: String(formData.get("seoMetaDescription") ?? "") || null,
    actorId: session!.user.id,
  });

  redirect(`/studio/catalogue/videos/${videoId}`);
}

// Phase 6J-1: publishing/unpublishing a catalogue page, and approving or revoking
// public exposure of an unlisted video, change what visitors see, so they need
// RECORDING_PUBLISH (see the note on publishCollectionAction) — drafting and
// editing a page stays CATALOGUE_WRITE.
export async function publishVideoPageAction(videoId: string, pageId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_PUBLISH")) {
    errorRedirect(videoId, "You do not have permission to publish this catalogue page.");
  }

  try {
    await publishVideoPage(pageId, session!.user.id);
  } catch (err) {
    errorRedirect(videoId, err instanceof Error ? err.message : "Could not publish the catalogue page.");
  }

  redirect(`/studio/catalogue/videos/${videoId}`);
}

export async function unpublishVideoPageAction(videoId: string, pageId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_PUBLISH")) {
    errorRedirect(videoId, "You do not have permission to unpublish this catalogue page.");
  }

  try {
    await unpublishVideoPage(pageId, session!.user.id);
  } catch (err) {
    errorRedirect(videoId, err instanceof Error ? err.message : "Could not unpublish the catalogue page.");
  }

  redirect(`/studio/catalogue/videos/${videoId}`);
}

export async function archiveVideoPageAction(videoId: string, pageId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(videoId, "You do not have permission to archive this catalogue page.");
  }

  await archiveVideoPage(pageId, session!.user.id);
  redirect(`/studio/catalogue/videos/${videoId}`);
}

export async function unarchiveVideoPageAction(videoId: string, pageId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(videoId, "You do not have permission to unarchive this catalogue page.");
  }

  await unarchiveVideoPage(pageId, session!.user.id);
  redirect(`/studio/catalogue/videos/${videoId}`);
}

export async function approveUnlistedPublicationAction(videoId: string, pageId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_PUBLISH")) {
    errorRedirect(videoId, "You do not have permission to approve this catalogue page for public Museum exposure.");
  }

  try {
    await approveUnlistedPublication(pageId, session!.user.id);
  } catch (err) {
    errorRedirect(videoId, err instanceof Error ? err.message : "Could not approve this catalogue page for public Museum exposure.");
  }

  redirect(`/studio/catalogue/videos/${videoId}`);
}

export async function revokeUnlistedApprovalAction(videoId: string, pageId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_PUBLISH")) {
    errorRedirect(videoId, "You do not have permission to revoke this catalogue page's public Museum approval.");
  }

  await revokeUnlistedApproval(pageId, session!.user.id);
  redirect(`/studio/catalogue/videos/${videoId}`);
}

// Phase 6K-2 — LISTING an approved unlisted video on discovery surfaces (catalogue, search, sitemap, homepage, featured) is its own,
// separately recorded approval; the page approval above never implies it. Both need RECORDING_PUBLISH, like every action that
// changes what visitors see. Revoking changes nothing on YouTube.
export async function approveDiscoveryAction(videoId: string, pageId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_PUBLISH")) {
    errorRedirect(videoId, "You do not have permission to approve this video for listing on the public Museum.");
  }

  try {
    await approveExposure({ videoPageId: pageId, scope: "DISCOVERY", actorId: session!.user.id });
  } catch (err) {
    errorRedirect(videoId, err instanceof Error ? err.message : "Could not approve this video for listing.");
  }

  redirect(`/studio/catalogue/videos/${videoId}`);
}

export async function revokeDiscoveryAction(videoId: string, pageId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_PUBLISH")) {
    errorRedirect(videoId, "You do not have permission to revoke this video's listing on the public Museum.");
  }

  try {
    await revokeExposure({ videoPageId: pageId, scope: "DISCOVERY", actorId: session!.user.id });
  } catch (err) {
    errorRedirect(videoId, err instanceof Error ? err.message : "Could not revoke the listing.");
  }

  redirect(`/studio/catalogue/videos/${videoId}`);
}
// Phase 6K-fix (F4) — a rights, copyright or privacy HOLD is part of the shared eligibility rule: while it stands the video is shown nowhere on the
// public Museum, whatever else is approved (public or unlisted). Recording or clearing one changes what visitors see, so both need RECORDING_PUBLISH.
// Clearing a hold approves nothing: approvals the hold revoked stay revoked.
const HOLDS: readonly VideoExposureHold[] = ["RIGHTS", "COPYRIGHT", "PRIVACY", "OTHER"];

export async function setVideoHoldAction(videoId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_PUBLISH")) {
    errorRedirect(videoId, "You do not have permission to record a hold on this video.");
  }
  const hold = String(formData.get("hold") ?? "") as VideoExposureHold;
  if (!HOLDS.includes(hold)) errorRedirect(videoId, "Choose the kind of hold.");

  try {
    await setReviewHold({ videoId, hold, note: String(formData.get("note") ?? "") || null, actorId: session!.user.id });
  } catch (err) {
    errorRedirect(videoId, err instanceof Error ? err.message : "Could not record the hold.");
  }

  redirect(`/studio/catalogue/videos/${videoId}`);
}

export async function clearVideoHoldAction(videoId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_PUBLISH")) {
    errorRedirect(videoId, "You do not have permission to clear a hold on this video.");
  }

  try {
    await clearReviewHold({ videoId, actorId: session!.user.id });
  } catch (err) {
    errorRedirect(videoId, err instanceof Error ? err.message : "Could not clear the hold.");
  }

  redirect(`/studio/catalogue/videos/${videoId}`);
}

// Lifecycle hardening (F12) — an editor has looked at the changed metadata of this approved page and accepts it. The page stayed public throughout;
// this only records that the change was reviewed. Needs RECORDING_PUBLISH, like every change to what visitors see.
export async function acknowledgeVideoMetadataAction(videoId: string, pageId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_PUBLISH")) {
    errorRedirect(videoId, "You do not have permission to review this video's metadata changes.");
  }

  try {
    await acknowledgeMetadataChange({ videoPageId: pageId, actorId: session!.user.id, note: String(formData.get("note") ?? "") || null });
  } catch (err) {
    errorRedirect(videoId, err instanceof Error ? err.message : "Could not record the metadata review.");
  }

  redirect(`/studio/catalogue/videos/${videoId}`);
}