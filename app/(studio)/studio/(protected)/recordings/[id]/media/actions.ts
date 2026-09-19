"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { attachMediaToRevision } from "../../../../../../../modules/db/repositories/mediaResourceRepository";
import type { MediaProvider, MediaRole } from "@prisma/client";

export async function attachMediaAction(recordingId: string, revisionId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_WRITE")) {
    redirect(`/studio/recordings/${recordingId}/media?error=You+do+not+have+permission+to+edit+this+recording.`);
  }

  const provider = String(formData.get("provider") ?? "") as MediaProvider;
  const role = String(formData.get("role") ?? "") as MediaRole;
  const url = String(formData.get("url") ?? "").trim();
  if (!provider || !role || !url) {
    redirect(`/studio/recordings/${recordingId}/media?error=Provider,+role,+and+URL+are+required.`);
  }

  await attachMediaToRevision({
    recordingRevisionId: revisionId,
    provider,
    role,
    url,
    providerResourceId: String(formData.get("providerResourceId") ?? "") || undefined,
    actorId: session!.user.id,
  });

  redirect(`/studio/recordings/${recordingId}/media`);
}
