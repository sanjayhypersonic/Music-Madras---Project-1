"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import {
  addPlaylistMember,
  approvePlaylistInclusion,
  archivePlaylistPage,
  movePlaylistMember,
  publishPlaylistPage,
  removePlaylistMember,
  revokePlaylistInclusion,
  syncPlaylistQualityNotification,
  unarchivePlaylistPage,
  unpublishPlaylistPage,
  updatePlaylistDraft,
} from "../../../../../../../modules/db/repositories/playlistPageRepository";

// Phase 6K-4 — Server Actions for one playlist page. Each re-checks the session and permission itself: editing the draft and its members is
// CATALOGUE_WRITE; publishing, unpublishing, archiving and approving an unlisted video for the playlist change what visitors see, so they are
// RECORDING_PUBLISH. Publishing and saving both carry the draft version the editor saw. The AI actions live in ./aiActions.ts.

const target = (id: string, query = "") => `/studio/catalogue/playlists/${id}${query}`;
const fail = (id: string, message: string): never => redirect(target(id, `?error=${encodeURIComponent(message)}`));
const ok = (id: string, message: string): never => redirect(target(id, `?notice=${encodeURIComponent(message)}`));

async function actor(id: string, action: "CATALOGUE_WRITE" | "RECORDING_PUBLISH") {
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE") redirect("/studio/signin");
  if (!can(session.user.role, action)) fail(id, "You do not have permission to do that.");
  return session.user;
}

const message = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

export async function saveDraftAction(id: string, formData: FormData) {
  const user = await actor(id, "CATALOGUE_WRITE");
  try {
    await updatePlaylistDraft({
      id,
      expectedVersion: Number(formData.get("expectedVersion") ?? "-1"),
      actorId: user.id,
      fields: { title: String(formData.get("title") ?? ""), summary: String(formData.get("summary") ?? ""), body: String(formData.get("body") ?? ""), seoTitle: String(formData.get("seoTitle") ?? ""), seoDescription: String(formData.get("seoDescription") ?? "") },
    });
  } catch (err) {
    fail(id, message(err, "The draft could not be saved."));
  }
  ok(id, "Draft saved. The live page is unchanged until you publish.");
}

/** An explicit quality check: evaluates the current draft now, and raises, updates or resolves the "cannot be published yet" notification to match. */
export async function checkQualityAction(id: string) {
  await actor(id, "CATALOGUE_WRITE");
  let outcome: Awaited<ReturnType<typeof syncPlaylistQualityNotification>> = "NONE";
  try {
    outcome = await syncPlaylistQualityNotification(id);
  } catch (err) {
    fail(id, message(err, "The check could not be completed."));
  }
  ok(
    id,
    outcome === "RESOLVED" || outcome === "NONE"
      ? "Checked: this draft passes every required check."
      : outcome === "UNCHANGED"
        ? "Checked: the same items are still missing (the existing notification stands)."
        : "Checked: some required items are missing. They are listed below and in your notifications."
  );
}

export async function addMemberAction(id: string, formData: FormData) {
  const user = await actor(id, "CATALOGUE_WRITE");
  const videoPageId = String(formData.get("videoPageId") ?? "");
  if (!videoPageId) fail(id, "Choose a video to add.");
  try {
    await addPlaylistMember({ playlistPageId: id, videoPageId, note: String(formData.get("note") ?? "") || null, actorId: user.id });
  } catch (err) {
    fail(id, message(err, "The video could not be added."));
  }
  ok(id, "Video added to the draft.");
}

export async function removeMemberAction(id: string, formData: FormData) {
  const user = await actor(id, "CATALOGUE_WRITE");
  try {
    await removePlaylistMember({ playlistPageId: id, videoPageId: String(formData.get("videoPageId") ?? ""), actorId: user.id });
  } catch (err) {
    fail(id, message(err, "The video could not be removed."));
  }
  ok(id, "Video removed from the draft.");
}

export async function moveMemberAction(id: string, formData: FormData) {
  const user = await actor(id, "CATALOGUE_WRITE");
  const direction = String(formData.get("direction") ?? "");
  if (direction !== "up" && direction !== "down") fail(id, "That request was incomplete.");
  try {
    await movePlaylistMember({ playlistPageId: id, videoPageId: String(formData.get("videoPageId") ?? ""), direction: direction as "up" | "down", actorId: user.id });
  } catch (err) {
    fail(id, message(err, "The video could not be moved."));
  }
  ok(id, "Order updated in the draft.");
}

export async function approveInclusionAction(id: string, formData: FormData) {
  const user = await actor(id, "RECORDING_PUBLISH");
  try {
    await approvePlaylistInclusion({ playlistPageId: id, videoPageId: String(formData.get("videoPageId") ?? ""), actorId: user.id, note: String(formData.get("note") ?? "") || null });
  } catch (err) {
    fail(id, message(err, "The approval could not be recorded."));
  }
  ok(id, "Approved for this playlist. YouTube is unchanged, and you can revoke this at any time.");
}

export async function revokeInclusionAction(id: string, formData: FormData) {
  const user = await actor(id, "RECORDING_PUBLISH");
  try {
    await revokePlaylistInclusion({ playlistPageId: id, videoPageId: String(formData.get("videoPageId") ?? ""), actorId: user.id });
  } catch (err) {
    fail(id, message(err, "The approval could not be revoked."));
  }
  ok(id, "Approval revoked: the video no longer appears on this playlist. YouTube is unchanged.");
}

export async function publishAction(id: string, formData: FormData) {
  const user = await actor(id, "RECORDING_PUBLISH");
  try {
    await publishPlaylistPage({ id, expectedVersion: Number(formData.get("expectedVersion") ?? "-1"), actorId: user.id });
  } catch (err) {
    fail(id, message(err, "The playlist page could not be published."));
  }
  ok(id, "Published.");
}

export async function unpublishAction(id: string) {
  const user = await actor(id, "RECORDING_PUBLISH");
  try {
    await unpublishPlaylistPage({ id, actorId: user.id });
  } catch (err) {
    fail(id, message(err, "The playlist page could not be unpublished."));
  }
  ok(id, "Taken off the public site.");
}

export async function archiveAction(id: string) {
  const user = await actor(id, "RECORDING_PUBLISH");
  try {
    await archivePlaylistPage({ id, actorId: user.id });
  } catch (err) {
    fail(id, message(err, "The playlist page could not be archived."));
  }
  ok(id, "Archived (and taken off the public site).");
}

export async function unarchiveAction(id: string) {
  const user = await actor(id, "CATALOGUE_WRITE");
  try {
    await unarchivePlaylistPage({ id, actorId: user.id });
  } catch (err) {
    fail(id, message(err, "The playlist page could not be restored."));
  }
  ok(id, "Restored as a draft.");
}
