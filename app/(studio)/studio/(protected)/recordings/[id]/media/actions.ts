"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { attachMediaToRevision } from "../../../../../../../modules/db/repositories/mediaResourceRepository";
import { resolveEditableDraftRevision } from "../../../../../../../modules/db/repositories/recordingRepository";
import { describeEditableDraftRefusal } from "../../../../../../../modules/publishing/editableDraftRefusal";
import { MediaProvider, MediaRole } from "@prisma/client";

// Phase 6J-1: see works/actions.ts — the bound revision id is only an expected
// token; the server resolves the Recording's editable draft and refuses anything else.

function fail(recordingId: string, message: string): never {
  redirect(`/studio/recordings/${recordingId}/media?error=${encodeURIComponent(message)}`);
}

export async function attachMediaAction(recordingId: string, revisionId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_WRITE")) {
    redirect(`/studio/recordings/${recordingId}/media?error=You+do+not+have+permission+to+edit+this+recording.`);
  }

  const providerRaw = String(formData.get("provider") ?? "");
  const roleRaw = String(formData.get("role") ?? "");
  const url = String(formData.get("url") ?? "").trim();
  if (!providerRaw || !roleRaw || !url) {
    redirect(`/studio/recordings/${recordingId}/media?error=Provider,+role,+and+URL+are+required.`);
  }
  // Only real enum values reach the repository (a forged value is a validation error, not a 500).
  if (!(Object.values(MediaProvider) as string[]).includes(providerRaw) || !(Object.values(MediaRole) as string[]).includes(roleRaw)) {
    fail(recordingId, "Choose a valid provider and role.");
  }

  const draft = await resolveEditableDraftRevision(recordingId, revisionId);
  if (!draft.ok) fail(recordingId, describeEditableDraftRefusal(draft.reason));

  await attachMediaToRevision({
    recordingRevisionId: draft.revisionId,
    provider: providerRaw as MediaProvider,
    role: roleRaw as MediaRole,
    url,
    providerResourceId: String(formData.get("providerResourceId") ?? "") || undefined,
    actorId: session!.user.id,
  });

  redirect(`/studio/recordings/${recordingId}/media`);
}
