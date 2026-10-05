import type { GenerateRecordingEditorialSuggestionResult } from "./generateRecordingEditorialSuggestion";

// Phase 6H-6 — the boundary between the gateway's technical failure detail
// and what a Studio editor is shown. Never forwards a provider stack trace,
// an HTTP header, a raw SDK error message, or any configuration detail —
// those stay in `ContentGenerationRequest.errorDetails` / the audit log for
// server-side inspection. Pure, no I/O.

export function describeGenerationFailureForEditor(result: Extract<GenerateRecordingEditorialSuggestionResult, { ok: false }>): string {
  // Discriminate on `generationRequest === null` first, not `reason`
  // directly — the third (generic) failure variant's `reason` is typed as
  // a plain `string`, which defeats TypeScript's usual literal-discriminant
  // narrowing if checked first.
  if (result.generationRequest === null) {
    if (result.reason === "RECORDING_CONTEXT_UNAVAILABLE") {
      switch (result.contextReason) {
        case "NOT_FOUND":
          return "This Recording could not be found.";
        case "ARCHIVED":
          return "This Recording is archived and cannot be used for editorial generation.";
        case "NO_PUBLISHED_REVISION":
          return "The Recording does not have enough published context to generate an editorial suggestion.";
        case "NO_DRAFT_REVISION":
          return "The Recording does not have the context needed to generate an editorial suggestion.";
        default:
          return "Editorial generation could not be completed.";
      }
    }
    if (result.reason === "RECORDING_NOT_PUBLISHED") {
      return "This Recording is not currently published, so editorial generation is not available for it. Publish it first.";
    }
    // result.reason === "GENERATION_ALREADY_IN_PROGRESS"
    return "An editorial suggestion is already being generated for this Recording. Please wait for it to finish before requesting another.";
  }

  // The generic failure branch: result.reason is a technical detail string
  // (an AIProviderErrorType prefix, or a structured-output validation
  // message) — never shown verbatim to an editor.
  if (result.reason.startsWith("CONFIGURATION")) {
    return "AI provider configuration is unavailable.";
  }
  if (result.reason.startsWith("AUTHENTICATION") || result.reason.startsWith("RATE_LIMIT") || result.reason.startsWith("TIMEOUT") || result.reason.startsWith("NETWORK") || result.reason.startsWith("PROVIDER_ERROR") || result.reason.startsWith("INVALID_REQUEST")) {
    return "Editorial generation could not be completed. Please try again later.";
  }
  if (result.reason.includes("Invalid structured output") || result.reason.includes("evidence")) {
    return "AI generation returned an invalid structured response.";
  }

  return "Editorial generation could not be completed.";
}
