import { buildEvidenceIndex } from "./buildEvidenceIndex";
import type { RecordingContext } from "../../mmke/contentIntelligence/recordingContextContract";
import type { ContentSuggestionEvidenceRef } from "../../mmke/contentIntelligence/contentSuggestionEvidence";

// Phase 6H-5 — the application-side re-validation of the model's structured
// output. LLM output is UNTRUSTED INPUT regardless of provider-side schema
// enforcement (brief: "THE APPLICATION MUST VALIDATE THE RESULT AGAIN").
// This function never coerces malformed output into something valid — it
// throws RecordingEditorialOutputValidationError, and the caller (the
// gateway) treats that as a failed generation, never a partial success.

const ALLOWED_TARGET_FIELDS = ["description", "educationalListeningGuide", "educationalAnalysis", "seoMetaTitle", "seoMetaDescription"] as const;
export type RecordingEditorialTargetField = (typeof ALLOWED_TARGET_FIELDS)[number];

const MAX_PROPOSED_CONTENT_LENGTH = 4000;
const MAX_GAP_FIELD_LENGTH = 500;

export class RecordingEditorialOutputValidationError extends Error {
  constructor(reason: string) {
    super(`Invalid structured output from the AI provider: ${reason}`);
    this.name = "RecordingEditorialOutputValidationError";
  }
}

export type ValidatedRecordingEditorialOutput =
  | { kind: "SUGGESTION"; proposedContent: string; targetField: RecordingEditorialTargetField; evidenceRefs: ContentSuggestionEvidenceRef[] }
  | { kind: "INFORMATION_GAP"; missingField: string; whyItMatters: string; requestedAction: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

const EXPECTED_KEYS = ["outputType", "proposedContent", "targetField", "evidenceEntityIds", "missingField", "whyItMatters", "requestedAction"] as const;

export function validateRecordingEditorialOutput(raw: unknown, context: RecordingContext): ValidatedRecordingEditorialOutput {
  if (!isPlainObject(raw)) {
    throw new RecordingEditorialOutputValidationError("expected a JSON object.");
  }

  const actualKeys = Object.keys(raw);
  const unexpectedKeys = actualKeys.filter((key) => !(EXPECTED_KEYS as readonly string[]).includes(key));
  if (unexpectedKeys.length > 0) {
    throw new RecordingEditorialOutputValidationError(`unexpected properties: ${unexpectedKeys.join(", ")}.`);
  }

  if (raw.outputType !== "SUGGESTION" && raw.outputType !== "INFORMATION_GAP") {
    throw new RecordingEditorialOutputValidationError('"outputType" must be "SUGGESTION" or "INFORMATION_GAP".');
  }

  if (raw.outputType === "INFORMATION_GAP") {
    if (!nonEmptyString(raw.missingField, MAX_GAP_FIELD_LENGTH)) {
      throw new RecordingEditorialOutputValidationError('"missingField" is required and must be a non-empty string for INFORMATION_GAP.');
    }
    if (!nonEmptyString(raw.whyItMatters, MAX_GAP_FIELD_LENGTH)) {
      throw new RecordingEditorialOutputValidationError('"whyItMatters" is required and must be a non-empty string for INFORMATION_GAP.');
    }
    if (!nonEmptyString(raw.requestedAction, MAX_GAP_FIELD_LENGTH)) {
      throw new RecordingEditorialOutputValidationError('"requestedAction" is required and must be a non-empty string for INFORMATION_GAP.');
    }
    return { kind: "INFORMATION_GAP", missingField: raw.missingField, whyItMatters: raw.whyItMatters, requestedAction: raw.requestedAction };
  }

  // outputType === "SUGGESTION"
  if (!nonEmptyString(raw.proposedContent, MAX_PROPOSED_CONTENT_LENGTH)) {
    throw new RecordingEditorialOutputValidationError(
      `"proposedContent" is required, must be a non-empty string, and at most ${MAX_PROPOSED_CONTENT_LENGTH} characters for SUGGESTION.`
    );
  }
  if (typeof raw.targetField !== "string" || !(ALLOWED_TARGET_FIELDS as readonly string[]).includes(raw.targetField)) {
    throw new RecordingEditorialOutputValidationError(`"targetField" must be one of: ${ALLOWED_TARGET_FIELDS.join(", ")}.`);
  }
  if (!Array.isArray(raw.evidenceEntityIds) || raw.evidenceEntityIds.some((id) => typeof id !== "string")) {
    throw new RecordingEditorialOutputValidationError('"evidenceEntityIds" must be an array of strings.');
  }

  const evidenceIndex = buildEvidenceIndex(context);
  const evidenceRefs = (raw.evidenceEntityIds as string[])
    .map((id) => evidenceIndex.get(id))
    .filter((ref): ref is ContentSuggestionEvidenceRef => ref !== undefined);

  if (evidenceRefs.length === 0) {
    throw new RecordingEditorialOutputValidationError(
      "no valid evidence references — every id in evidenceEntityIds was either absent or not present in the supplied context."
    );
  }

  return { kind: "SUGGESTION", proposedContent: raw.proposedContent, targetField: raw.targetField as RecordingEditorialTargetField, evidenceRefs };
}
