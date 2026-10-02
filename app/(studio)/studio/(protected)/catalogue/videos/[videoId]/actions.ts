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
import { createRecordingFromYouTubeVideo } from "../../../../../../../modules/db/repositories/recordingIntakeRepository";

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
