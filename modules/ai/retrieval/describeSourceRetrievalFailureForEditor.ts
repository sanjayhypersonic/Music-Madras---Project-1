import type { SourceRetrievalErrorType } from "./sourceRetrievalAdapter";

// Phase 6H-9 — the boundary between a retrieval adapter's technical failure
// detail and what a Studio editor is shown, mirroring
// modules/ai/gateway/describeGenerationFailureForEditor.ts's role. Never
// forwards a raw network error message or response body — those stay in
// the audit log (EXTERNAL_SOURCE_RETRIEVAL_FAILED's afterSnapshot) for
// server-side inspection. Pure, no I/O.

export function describeSourceRetrievalFailureForEditor(errorType: SourceRetrievalErrorType): string {
  switch (errorType) {
    case "SOURCE_NOT_FOUND":
      return "This source could not be found.";
    case "SOURCE_NOT_APPROVED":
      return "This source must be APPROVED before its content can be retrieved.";
    case "UNSUPPORTED_PROVIDER":
      return "This source's URL is not a recognized Wikipedia page — retrieval is only supported for a registered en.wikipedia.org page.";
    case "EXTERNAL_PAGE_NOT_FOUND":
      return "Wikipedia does not have a page at this source's registered URL.";
    case "MALFORMED_RESPONSE":
      return "Wikipedia returned a response that could not be safely read.";
    case "TIMEOUT":
      return "The request to Wikipedia timed out. Please try again.";
    case "UNAVAILABLE":
      return "Wikipedia could not be reached. Please try again later.";
    case "MISSING_ACTOR":
      return "You must be signed in to retrieve this source.";
    default:
      return "This source's content could not be retrieved.";
  }
}
