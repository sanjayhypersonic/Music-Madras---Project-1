"use server";

import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { can } from "../../../../../modules/auth/policy";
import { generateRecordingEditorialSuggestion } from "../../../../../modules/ai/gateway/generateRecordingEditorialSuggestion";
import type { GenerateRecordingEditorialSuggestionResult } from "../../../../../modules/ai/gateway/generateRecordingEditorialSuggestion";

// Phase 6H-5 — the minimal, RBAC-gated entry point proving the AI
// Generation Gateway is authenticated and permission-gated server-side
// (docs/content-intelligence-architecture.md Phase 6H-2 §34: requesting
// generation reuses RECORDING_WRITE, the same permission that already lets
// a Contributor create a Recording draft — no new permission was needed).
//
// Deliberately NOT wired to any Studio button or page yet — 6H-5 is gateway
// foundation, not the editorial generation experience (that is 6H-6's
// scope). This exists so the "generation must be server-side, authenticated,
// permission-gated" requirement is real, enforced code, not only a policy
// table.

export type RequestRecordingEditorialGenerationActionResult =
  | { authorized: false }
  | { authorized: true; result: GenerateRecordingEditorialSuggestionResult };

export async function requestRecordingEditorialGenerationAction(recordingId: string): Promise<RequestRecordingEditorialGenerationActionResult> {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_WRITE")) {
    return { authorized: false };
  }

  const result = await generateRecordingEditorialSuggestion({ recordingId, requestedById: session.user.id });
  return { authorized: true, result };
}
