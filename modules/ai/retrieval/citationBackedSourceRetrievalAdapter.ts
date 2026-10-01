import { createHash } from "node:crypto";
import { findSourceById } from "../../db/repositories/sourceRepository";
import { listCitationsForSource } from "../../db/repositories/citationRepository";
import type { SourceRetrievalAdapter, SourceRetrievalRequest, SourceRetrievalResult } from "./sourceRetrievalAdapter";

// Phase 6H-8 — the only real SourceRetrievalAdapter in this phase. It
// performs NO network request and does no web browsing/crawling: it reads
// the Citation text an editor has already typed in for this Source via the
// Studio (modules/db/repositories/citationRepository.ts, unchanged). This
// is a deliberately honest implementation of the retrieval contract — it
// gives a future phase a seam to add a real HTTP-fetching adapter without
// any change to the Recording Context Assembler or AI Gateway, rather than
// this phase pretending to do live external retrieval it was explicitly
// told not to build.
//
// Re-checks approval state itself (rather than trusting the caller) as a
// defensive guard against a race between the Context Assembler's
// listApprovedSourcesForEntity query and this call — belt-and-braces, not
// the primary enforcement point (that remains the APPROVED-only query).

export class CitationBackedSourceRetrievalAdapter implements SourceRetrievalAdapter {
  async retrieve(request: SourceRetrievalRequest): Promise<SourceRetrievalResult> {
    const retrievedAt = new Date();

    const source = await findSourceById(request.sourceId);
    if (!source) {
      return {
        ok: false,
        sourceId: request.sourceId,
        error: { type: "SOURCE_NOT_FOUND", message: `Source ${request.sourceId} does not exist.` },
        retrievedAt,
      };
    }
    if (source.approvalState !== "APPROVED") {
      return {
        ok: false,
        sourceId: request.sourceId,
        error: {
          type: "SOURCE_NOT_APPROVED",
          message: `Source ${request.sourceId} is not APPROVED (current state: ${source.approvalState}).`,
        },
        retrievedAt,
      };
    }

    const citations = await listCitationsForSource(request.sourceId);
    const normalized = citations.map((citation) => ({ id: citation.id, text: citation.text })).sort((a, b) => a.id.localeCompare(b.id));

    const contentFingerprint = normalized.length > 0 ? createHash("sha256").update(JSON.stringify(normalized)).digest("hex") : null;

    return { ok: true, sourceId: request.sourceId, citations: normalized, contentFingerprint, retrievedAt };
  }
}
