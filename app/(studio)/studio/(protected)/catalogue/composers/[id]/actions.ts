"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { archiveComposer, restoreComposer, updateComposer } from "../../../../../../../modules/db/repositories/composerRepository";

// Phase 6G-4C — Server Actions for the per-Composer Studio detail page,
// mirroring the established pattern in catalogue/videos/[videoId]/
// actions.ts: every action re-checks the session and CATALOGUE_WRITE
// itself, then calls straight into the repository.

function errorRedirect(composerId: string, message: string): never {
  redirect(`/studio/catalogue/composers/${composerId}?error=${encodeURIComponent(message)}`);
}

export async function updateComposerAction(composerId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(composerId, "You do not have permission to edit this composer.");
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    errorRedirect(composerId, "Name is required.");
  }

  await updateComposer(composerId, {
    name,
    bornDate: String(formData.get("bornDate") ?? "") || null,
    diedDate: String(formData.get("diedDate") ?? "") || null,
    era: String(formData.get("era") ?? "") || null,
    biography: String(formData.get("biography") ?? "") || null,
    actorId: session!.user.id,
  });

  redirect(`/studio/catalogue/composers/${composerId}`);
}

export async function archiveComposerAction(composerId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(composerId, "You do not have permission to archive this composer.");
  }

  await archiveComposer(composerId, session!.user.id);
  redirect(`/studio/catalogue/composers/${composerId}`);
}

export async function restoreComposerAction(composerId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(composerId, "You do not have permission to restore this composer.");
  }

  await restoreComposer(composerId, session!.user.id);
  redirect(`/studio/catalogue/composers/${composerId}`);
}
