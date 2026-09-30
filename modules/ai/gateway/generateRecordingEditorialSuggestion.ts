import { getRecordingContext } from "../../db/repositories/recordingContextRepository";
import type { RecordingContextResult } from "../../db/repositories/recordingContextRepository";
import type { RecordingContextMode } from "../../mmke/contentIntelligence/recordingContextContract";
import {
  completeGenerationRequest,
  createGenerationRequest,
  createSuggestion,
  findActiveGenerationRequestForEntity,
  markGenerationRequestGenerating,
} from "../../db/repositories/contentSuggestionRepository";
import { computeContextFingerprint } from "../../mmke/contentIntelligence/computeContextFingerprint";
import {
  RECORDING_EDITORIAL_OUTPUT_SCHEMA_V2,
  RECORDING_EDITORIAL_PROMPT_V2,
  RECORDING_EDITORIAL_SYSTEM_INSTRUCTIONS_V2,
} from "../prompts/recordingEditorial/recordingEditorialPromptV2";
import { validateRecordingEditorialOutput } from "../structuredOutput/validateRecordingEditorialOutput";
import { getConfiguredAIProvider } from "../provider/aiProviderRegistry";
import type { AIProvider } from "../provider/aiProvider";
import type { ContentGenerationRequest, ContentSuggestion } from "@prisma/client";

// Phase 6H-5 — the AI Generation Gateway: the one place that wires
// RecordingContext (6H-3) + ContentGenerationRequest/ContentSuggestion
// (6H-4) + a provider-neutral AIProvider (this phase) together.
//
// Phase 6H-6 is this function's first real caller (via
// app/(studio)/studio/(protected)/content-suggestions/generateAction.ts) and
// added the duplicate-generation guard below. Nothing still calls this
// automatically — no scheduler, no bulk job, no YouTube-sync trigger — every
// invocation is one explicit, authenticated Studio action.
//
// Dependency direction (enforced by these imports, not just documented):
// this file imports FROM modules/db/repositories/** and modules/ai/**, and
// nothing in either of those imports this file back. It never imports
// Prisma directly (ADR §3 boundary rule) and never imports a provider SDK
// directly — only the provider-neutral AIProvider interface.

export interface GenerateRecordingEditorialSuggestionInput {
  recordingId: string;
  mode?: RecordingContextMode;
  requestedById: string;
  /** Injectable for tests — defaults to the configuration-selected provider (AI_PROVIDER env var). */
  provider?: AIProvider;
}

export type GenerateRecordingEditorialSuggestionResult =
  | { ok: true; generationRequest: ContentGenerationRequest; suggestion: ContentSuggestion }
  | { ok: false; generationRequest: null; reason: "RECORDING_CONTEXT_UNAVAILABLE"; contextReason: Exclude<RecordingContextResult, { ok: true }>["reason"] }
  | { ok: false; generationRequest: null; reason: "GENERATION_ALREADY_IN_PROGRESS" }
  | { ok: false; generationRequest: ContentGenerationRequest; reason: string };

/**
 * Recording -> RecordingContext -> ContentGenerationRequest -> AIProvider ->
 * validated structured output -> ContentSuggestion. Every step that can
 * fail leaves the ContentGenerationRequest in a terminal, inspectable state
 * (SUCCEEDED only once the ContentSuggestion is durably created; FAILED
 * with a human-readable, secret-free errorDetails otherwise) — never a
 * silent partial success, and never a retry loop that could create a second
 * ContentGenerationRequest for the same call (brief: idempotency).
 */
export async function generateRecordingEditorialSuggestion(
  input: GenerateRecordingEditorialSuggestionInput
): Promise<GenerateRecordingEditorialSuggestionResult> {
  const mode: RecordingContextMode = input.mode ?? "PUBLISHED";

  const contextResult = await getRecordingContext(input.recordingId, mode);
  if (!contextResult.ok) {
    return { ok: false, generationRequest: null, reason: "RECORDING_CONTEXT_UNAVAILABLE", contextReason: contextResult.reason };
  }

  // Duplicate-generation guard (brief: "do not create uncontrolled duplicate
  // suggestions"): refuse a second generation while one is already active
  // for this target, rather than silently overwriting or racing it. Does
  // NOT block a later, intentional re-generation once the prior one has
  // reached a terminal state (SUCCEEDED/FAILED).
  const activeRequest = await findActiveGenerationRequestForEntity("RECORDING", input.recordingId);
  if (activeRequest) {
    return { ok: false, generationRequest: null, reason: "GENERATION_ALREADY_IN_PROGRESS" };
  }

  const contextFingerprint = computeContextFingerprint(contextResult.context);
  const provider = input.provider ?? getConfiguredAIProvider();

  const generationRequest = await createGenerationRequest({
    targetEntityType: "RECORDING",
    targetEntityId: input.recordingId,
    suggestionType: "EDITORIAL_PROSE",
    contextFingerprint,
    provider: provider.providerName,
    promptVersion: RECORDING_EDITORIAL_PROMPT_V2,
    requestedById: input.requestedById,
  });

  const fail = async (errorDetails: string): Promise<GenerateRecordingEditorialSuggestionResult> => {
    const failed = await completeGenerationRequest(generationRequest.id, { status: "FAILED", errorDetails });
    return { ok: false, generationRequest: failed, reason: errorDetails };
  };

  await markGenerationRequestGenerating(generationRequest.id);

  const aiResult = await provider.generate({
    systemInstructions: RECORDING_EDITORIAL_SYSTEM_INSTRUCTIONS_V2,
    contextPayload: contextResult.context,
    outputSchema: RECORDING_EDITORIAL_OUTPUT_SCHEMA_V2,
    promptVersion: RECORDING_EDITORIAL_PROMPT_V2,
    targetEntityType: "RECORDING",
    targetEntityId: input.recordingId,
    suggestionType: "EDITORIAL_PROSE",
    contextFingerprint,
  });

  if (!aiResult.ok) {
    return fail(`${aiResult.error.type}: ${aiResult.error.message}`);
  }

  let validated;
  try {
    validated = validateRecordingEditorialOutput(aiResult.output, contextResult.context);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Structured output validation failed.");
  }

  try {
    const suggestion =
      validated.kind === "SUGGESTION"
        ? await createSuggestion({
            generationRequestId: generationRequest.id,
            suggestionType: "EDITORIAL_PROSE",
            targetEntityType: "RECORDING",
            targetEntityId: input.recordingId,
            targetField: validated.targetField,
            proposedContent: validated.proposedContent,
            evidenceRefs: validated.evidenceRefs,
          })
        : await createSuggestion({
            generationRequestId: generationRequest.id,
            suggestionType: "INFORMATION_GAP",
            targetEntityType: "RECORDING",
            targetEntityId: input.recordingId,
            targetField: null,
            proposedContent: JSON.stringify({
              missingField: validated.missingField,
              whyItMatters: validated.whyItMatters,
              requestedAction: validated.requestedAction,
            }),
            evidenceRefs: [],
          });

    await completeGenerationRequest(generationRequest.id, { status: "SUCCEEDED" });
    return { ok: true, generationRequest: { ...generationRequest, status: "SUCCEEDED" }, suggestion };
  } catch (err) {
    return fail(err instanceof Error ? `Failed to persist the suggestion: ${err.message}` : "Failed to persist the suggestion.");
  }
}
