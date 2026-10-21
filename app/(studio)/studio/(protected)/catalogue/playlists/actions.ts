"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { createPlaylistPage } from "../../../../../../modules/db/repositories/playlistPageRepository";
import { PlaylistInvalidError } from "../../../../../../modules/mmke/playlists/playlistErrors";

// Phase 6K-4 — starting a playlist page is a draft action (CATALOGUE_WRITE); it publishes nothing.

export async function createPlaylistPageAction(formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE") redirect("/studio/signin");
  if (!can(session.user.role, "CATALOGUE_WRITE")) redirect(`/studio/catalogue/playlists?error=${encodeURIComponent("You do not have permission to create a playlist page.")}`);
  const youtubePlaylistId = String(formData.get("youtubePlaylistId") ?? "") || null;
  let id: string;
  try {
    const page = await createPlaylistPage({
      title: String(formData.get("title") ?? ""),
      youtubePlaylistId,
      seedMembersFromYouTube: formData.get("seedMembers") === "on",
      actorId: session.user.id,
    });
    id = page.id;
  } catch (err) {
    const message = err instanceof PlaylistInvalidError ? err.message : "The playlist page could not be created.";
    redirect(`/studio/catalogue/playlists?error=${encodeURIComponent(message)}`);
  }
  redirect(`/studio/catalogue/playlists/${id}`);
}
