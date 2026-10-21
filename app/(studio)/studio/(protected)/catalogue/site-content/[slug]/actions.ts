"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import {
  createEditorialDraft,
  createEditorialDraftFromBuiltIn,
  publishEditorialContent,
  unpublishEditorialContent,
  updateEditorialDraft,
} from "../../../../../../../modules/db/repositories/editorialContentRepository";
import {
  EditorialBlockExistsError,
  EditorialBlockUnknownError,
  EditorialConflictError,
  EditorialContentNotFoundError,
  EditorialInvalidError,
} from "../../../../../../../modules/mmke/editorial/editorialErrors";

// Phase 6K-1 — Server Actions for site-level editorial content. Each re-checks the session and the permission itself:
// editing a draft is CATALOGUE_WRITE; publishing or unpublishing changes what visitors see, so it is RECORDING_PUBLISH
// (the 6J-1 rule — no permission was added or widened). Saving and publishing both carry the draft version the editor saw.

function target(slug: string, query = ""): string {
  return `/studio/catalogue/site-content/${encodeURIComponent(slug)}${query}`;
}

function message(err: unknown): string {
  if (
    err instanceof EditorialInvalidError ||
    err instanceof EditorialConflictError ||
    err instanceof EditorialContentNotFoundError ||
    err instanceof EditorialBlockUnknownError ||
    err instanceof EditorialBlockExistsError
  ) {
    return err.message;
  }
  return "The change could not be saved. Please try again.";
}

async function requireActor(slug: string, action: "CATALOGUE_WRITE" | "RECORDING_PUBLISH") {
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE") redirect("/studio/signin");
  if (!can(session.user.role, action)) redirect(target(slug, `?error=${encodeURIComponent("You do not have permission to do that.")}`));
  return session.user;
}

export async function createDraftAction(slug: string) {
  const actor = await requireActor(slug, "CATALOGUE_WRITE");
  try {
    await createEditorialDraft({ slug, title: "", actorId: actor.id });
  } catch (err) {
    redirect(target(slug, `?error=${encodeURIComponent(message(err))}`));
  }
  redirect(target(slug));
}

export async function createDraftFromBuiltInAction(slug: string) {
  const actor = await requireActor(slug, "CATALOGUE_WRITE");
  try {
    await createEditorialDraftFromBuiltIn({ slug, actorId: actor.id });
  } catch (err) {
    redirect(target(slug, `?error=${encodeURIComponent(message(err))}`));
  }
  redirect(target(slug));
}

export async function saveDraftAction(slug: string, formData: FormData) {
  const actor = await requireActor(slug, "CATALOGUE_WRITE");
  try {
    await updateEditorialDraft({
      slug,
      expectedVersion: Number(formData.get("expectedVersion") ?? "-1"),
      actorId: actor.id,
      fields: {
        title: String(formData.get("title") ?? ""),
        body: formData.has("body") ? String(formData.get("body") ?? "") : null,
        seoTitle: formData.has("seoTitle") ? String(formData.get("seoTitle") ?? "") : null,
        seoDescription: formData.has("seoDescription") ? String(formData.get("seoDescription") ?? "") : null,
      },
    });
  } catch (err) {
    redirect(target(slug, `?error=${encodeURIComponent(message(err))}`));
  }
  redirect(target(slug, "?saved=1"));
}

export async function publishAction(slug: string, formData: FormData) {
  const actor = await requireActor(slug, "RECORDING_PUBLISH");
  try {
    await publishEditorialContent({ slug, expectedVersion: Number(formData.get("expectedVersion") ?? "-1"), actorId: actor.id });
  } catch (err) {
    redirect(target(slug, `?error=${encodeURIComponent(message(err))}`));
  }
  redirect(target(slug, "?published=1"));
}

export async function unpublishAction(slug: string) {
  const actor = await requireActor(slug, "RECORDING_PUBLISH");
  try {
    await unpublishEditorialContent({ slug, actorId: actor.id });
  } catch (err) {
    redirect(target(slug, `?error=${encodeURIComponent(message(err))}`));
  }
  redirect(target(slug, "?unpublished=1"));
}
