import { getRecordingContext } from "../../db/repositories/recordingContextRepository";
import type { RecordingContextResult } from "../../db/repositories/recordingContextRepository";
import type { RecordingContextMode } from "../../mmke/contentIntelligence/recordingContextContract";
import {
  completeGenerationRequest,
  createGenerationRequest,
  createSuggestion,
  markGenerationRequestGenerating,
} from "../../db/repositories/contentSuggestionRepository";
import { computeContextFingerprint } from "../../mmke/contentIntelligence/computeContextFingerprint";
import {
  RECORDING_EDITORIAL_OUTPUT_SCHEMA_V1,
  RECORDING_EDITORIAL_PROMPT_V1,
  RECORDING_EDITORIAL_SYSTEM_INSTRUCTIONS_V1,
} from "../prompts/recordingEditorial/recordingEditorialPromptV1";
import { validateRecordingEditorialOutput } from "../structuredOutput/validateRecordingEditorialOutput";
import { getConfiguredAIProvider } from "../provider/aiProviderRegistry";
import type { AIProvider } from "../provider/aiProvider";
import type { ContentGenerationRequest, ContentSuggestion } from "@prisma/client";

// Phase 6H-5 — the AI Generation Gateway: the one place that wires
// RecordingContext (6H-3) + ContentGenerationRequest/ContentSuggestion
// (6H-4) + a provider-neutral AIProvider (this phase) together. This is
// gateway FOUNDATION, not the 6H-6 editorial workflow — nothing calls this
// function automatically, there is no bulk/scheduled invocation anywhere,
// and no Studio UI button triggers it yet (brief: "6H-6 will own the first
// controlled real generation workflow").
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

  const contextFingerprint = computeContextFingerprint(contextResult.context);
  const provider = input.provider ?? getConfiguredAIProvider();

  const generationRequest = await createGenerationRequest({
    targetEntityType: "RECORDING",
    targetEntityId: input.recordingId,
    suggestionType: "EDITORIAL_PROSE",
    contextFingerprint,
    provider: provider.providerName,
    promptVersion: RECORDING_EDITORIAL_PROMPT_V1,
    requestedById: input.requestedById,
  });

  const fail = async (errorDetails: string): Promise<GenerateRecordingEditorialSuggestionResult> => {
    const failed = await completeGenerationRequest(generationRequest.id, { status: "FAILED", errorDetails });
    return { ok: false, generationRequest: failed, reason: errorDetails };
  };

  await markGenerationRequestGenerating(generationRequest.id);

  const aiResult = await provider.generate({
    systemInstructions: RECORDING_EDITORIAL_SYSTEM_INSTRUCTIONS_V1,
    contextPayload: contextResult.context,
    outputSchema: RECORDING_EDITORIAL_OUTPUT_SCHEMA_V1,
    promptVersion: RECORDING_EDITORIAL_PROMPT_V1,
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
