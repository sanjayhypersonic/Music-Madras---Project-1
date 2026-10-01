"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { approveSource, disableSource, rejectSource, updateSource } from "../../../../../../../modules/db/repositories/sourceRepository";
import { createCitation, updateCitation } from "../../../../../../../modules/db/repositories/citationRepository";

function errorRedirect(sourceId: string, message: string): never {
  redirect(`/studio/catalogue/sources/${sourceId}?error=${encodeURIComponent(message)}`);
}

export async function updateSourceAction(sourceId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(sourceId, "You do not have permission to edit this source.");
  }

  await updateSource(sourceId, {
    title: String(formData.get("title") ?? "").trim() || null,
    url: String(formData.get("url") ?? "").trim() || null,
    publisher: String(formData.get("publisher") ?? "").trim() || null,
    actorId: session!.user.id,
  });

  redirect(`/studio/catalogue/sources/${sourceId}`);
}

// Phase 6H-8 — these are the only Studio entry points that change
// Source.approvalState. Reuses CATALOGUE_WRITE (the same permission that
// already gates editing a Source) rather than introducing a new permission
// — approving a Source for AI evidence is a continuation of the same
// editorial-trust judgement as editing its metadata, not a distinct
// reviewer role (docs/content-intelligence-architecture.md Phase 6H-8
// section).

export async function approveSourceAction(sourceId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(sourceId, "You do not have permission to approve this source.");
  }

  try {
    await approveSource(sourceId, session!.user.id);
  } catch (error) {
    errorRedirect(sourceId, error instanceof Error ? error.message : "Could not approve this source.");
  }

  redirect(`/studio/catalogue/sources/${sourceId}`);
}

export async function rejectSourceAction(sourceId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(sourceId, "You do not have permission to reject this source.");
  }

  try {
    await rejectSource(sourceId, session!.user.id);
  } catch (error) {
    errorRedirect(sourceId, error instanceof Error ? error.message : "Could not reject this source.");
  }

  redirect(`/studio/catalogue/sources/${sourceId}`);
}

export async function disableSourceAction(sourceId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(sourceId, "You do not have permission to disable this source.");
  }

  try {
    await disableSource(sourceId, session!.user.id);
  } catch (error) {
    errorRedirect(sourceId, error instanceof Error ? error.message : "Could not disable this source.");
  }

  redirect(`/studio/catalogue/sources/${sourceId}`);
}

export async function addCitationAction(sourceId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(sourceId, "You do not have permission to edit this source.");
  }

  const text = String(formData.get("text") ?? "").trim();
  if (!text) {
    errorRedirect(sourceId, "Citation text is required.");
  }

  await createCitation({ text, sourceId, actorId: session!.user.id });
  redirect(`/studio/catalogue/sources/${sourceId}`);
}

export async function updateCitationAction(sourceId: string, citationId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(sourceId, "You do not have permission to edit this source.");
  }

  await updateCitation(citationId, {
    text: String(formData.get("text") ?? "").trim() || null,
    actorId: session!.user.id,
  });

  redirect(`/studio/catalogue/sources/${sourceId}`);
}
