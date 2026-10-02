"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { can } from "../../../../../modules/auth/policy";
import { generateRecordingEditorialSuggestion } from "../../../../../modules/ai/gateway/generateRecordingEditorialSuggestion";
import { describeGenerationFailureForEditor } from "../../../../../modules/ai/gateway/describeGenerationFailureForEditor";

// Phase 6H-6 — the first real, explicit, authenticated entry point into the
// AI Generation Gateway (6H-5). Bound to the "Generate an editorial
// suggestion" form on /studio/content-suggestions. Reuses RECORDING_WRITE
// exactly as 6H-2 §34/6H-5 §67 established — no new permission. The browser
// never talks to a provider: this function is the entire server boundary,
// and only ever returns a redirect — success goes straight to the new
// suggestion's review page; failure goes back to the list with a safe,
// secret-free message (modules/ai/gateway/describeGenerationFailureForEditor.ts).

// Phase 6I-3: the Editorial Operations Queue (/studio/editorial) reuses this
// exact action for its "Generate suggestion" / "Regenerate" buttons, so
// permission, the duplicate-generation guard and the audit trail are the same
// code path. It only differs in where a FAILURE lands: the form may carry a
// `returnTo` naming the queue, so the editor sees the message where they
// clicked. Anything but the queue path (an exact, relative /studio/editorial
// URL) is ignored — never an open redirect.
const QUEUE_RETURN_PATH = /^\/studio\/editorial(\?[A-Za-z0-9_=&%.+-]*)?$/;

function errorRedirect(message: string, returnTo?: string | null): never {
  if (returnTo && QUEUE_RETURN_PATH.test(returnTo)) {
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
  }
  redirect(`/studio/content-suggestions?error=${encodeURIComponent(message)}`);
}

export async function generateEditorialSuggestionAction(formData: FormData): Promise<void> {
  const returnTo = String(formData.get("returnTo") ?? "").trim() || null;

  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_WRITE")) {
    errorRedirect("You do not have permission to request an editorial suggestion.", returnTo);
  }

  const recordingId = String(formData.get("recordingId") ?? "").trim();
  if (!recordingId) {
    errorRedirect("Select a Recording to generate an editorial suggestion for.", returnTo);
  }

  const result = await generateRecordingEditorialSuggestion({ recordingId, requestedById: session!.user.id });

  if (result.ok) {
    redirect(`/studio/content-suggestions/${result.suggestion.id}`);
  }

  errorRedirect(describeGenerationFailureForEditor(result), returnTo);
}
