import { createHash } from "node:crypto";
import { findSourceById, recordSourceRetrievalFailure, recordSourceRetrievalSuccess } from "../../../db/repositories/sourceRepository";
import { createCitation, listCitationsForSource, updateCitation } from "../../../db/repositories/citationRepository";
import { extractWikipediaPageTitle } from "./extractWikipediaPageTitle";
import { RealWikipediaRestClient } from "./wikipediaRestClient";
import type { WikipediaRestClient, WikipediaSummary } from "./wikipediaRestClient";
import type { SourceRetrievalAdapter, SourceRetrievalChangeStatus, SourceRetrievalRequest, SourceRetrievalResult } from "../sourceRetrievalAdapter";

// Phase 6H-9 — the first REAL external Source Retrieval Adapter
// (docs/content-intelligence-architecture.md, Phase 6H-9 section):
//
//   Source Retrieval Adapter -> Wikipedia REST Adapter
//
// This is a controlled, single-provider adapter, NOT a generalized web
// fetcher: it only ever retrieves the ONE Wikipedia page a Source was
// already explicitly registered with (extractWikipediaPageTitle, derived
// from Source.url, never supplied dynamically by a caller or an AI). Unlike
// CitationBackedSourceRetrievalAdapter (6H-8, read-only), this adapter
// performs real writes — it persists the retrieved extract as a Citation
// and records the retrieval outcome on the Source row — so every write is
// attributed to a real, authenticated Studio actor (request.actorId);
// never a system placeholder.
//
// Every repository call here is Prisma-free at this file's level (ADR §3
// boundary rule) — all persistence goes through sourceRepository.ts /
// citationRepository.ts, exactly like every other adapter/gateway in this
// codebase.

function computeContentFingerprint(summary: WikipediaSummary): string {
  return createHash("sha256")
    .update(JSON.stringify({ title: summary.title, description: summary.description, extract: summary.extract }))
    .digest("hex");
}

function determineChangeStatus(previousFingerprint: string | null, newFingerprint: string): SourceRetrievalChangeStatus {
  if (previousFingerprint === null) return "FIRST_RETRIEVAL";
  return previousFingerprint === newFingerprint ? "UNCHANGED" : "CHANGED";
}

/**
 * Upserts the single Citation this adapter manages for a Wikipedia-backed
 * Source. By convention (documented, not schema-enforced — Citation has no
 * "managed by" flag and none was added, per the brief's migration-avoidance
 * rule): a Source registered as a Wikipedia page is expected to carry
 * exactly the one Citation this adapter maintains, never a manually-entered
 * one. If more than one Citation already exists (a convention violation,
 * not an expected state), the most recently created one is updated and the
 * others are left untouched rather than guessed at or deleted.
 */
async function upsertRetrievedCitation(sourceId: string, text: string | null, actorId: string) {
  const existing = await listCitationsForSource(sourceId); // already ordered createdAt desc
  if (existing.length === 0) {
    return createCitation({ text: text ?? undefined, sourceId, actorId });
  }
  return updateCitation(existing[0].id, { text, actorId });
}

export class WikipediaSourceRetrievalAdapter implements SourceRetrievalAdapter {
  constructor(private readonly client: WikipediaRestClient = new RealWikipediaRestClient()) {}

  async retrieve(request: SourceRetrievalRequest): Promise<SourceRetrievalResult> {
    const retrievedAt = new Date();
    const { sourceId, actorId } = request;

    const source = await findSourceById(sourceId);
    if (!source) {
      return { ok: false, sourceId, error: { type: "SOURCE_NOT_FOUND", message: `Source ${sourceId} does not exist.` }, retrievedAt };
    }

    if (!actorId) {
      // No audit write — there is no existing actor to attribute a failure to.
      return { ok: false, sourceId, error: { type: "MISSING_ACTOR", message: "External retrieval requires an authenticated Studio actor." }, retrievedAt };
    }

    if (source.approvalState !== "APPROVED") {
      await recordSourceRetrievalFailure(sourceId, actorId, "SOURCE_NOT_APPROVED", `Source ${sourceId} is not APPROVED (current state: ${source.approvalState}).`);
      return {
        ok: false,
        sourceId,
        error: { type: "SOURCE_NOT_APPROVED", message: `Source ${sourceId} is not APPROVED (current state: ${source.approvalState}).` },
        retrievedAt,
      };
    }

    const pageTitle = extractWikipediaPageTitle(source.url);
    if (!pageTitle) {
      await recordSourceRetrievalFailure(sourceId, actorId, "UNSUPPORTED_PROVIDER", `Source ${sourceId}'s url is not a recognized en.wikipedia.org page URL.`);
      return {
        ok: false,
        sourceId,
        error: { type: "UNSUPPORTED_PROVIDER", message: `Source ${sourceId}'s url is not a recognized en.wikipedia.org page URL.` },
        retrievedAt,
      };
    }

    const fetchResult = await this.client.fetchSummary(pageTitle);
    if (!fetchResult.ok) {
      await recordSourceRetrievalFailure(sourceId, actorId, fetchResult.error.type, fetchResult.error.message);
      return { ok: false, sourceId, error: fetchResult.error, retrievedAt };
    }

    const contentFingerprint = computeContentFingerprint(fetchResult.summary);
    const changeStatus = determineChangeStatus(source.contentFingerprint, contentFingerprint);

    const citation = await upsertRetrievedCitation(sourceId, fetchResult.summary.extract, actorId);
    await recordSourceRetrievalSuccess(sourceId, actorId, { contentFingerprint, changeStatus });

    return {
      ok: true,
      sourceId,
      citations: [{ id: citation.id, text: citation.text }],
      contentFingerprint,
      retrievedAt,
      changeStatus,
    };
  }
}
