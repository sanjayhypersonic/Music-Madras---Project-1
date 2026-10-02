import { WikipediaSourceRetrievalAdapter } from "./wikipedia/wikipediaSourceRetrievalAdapter";
import type { SourceRetrievalAdapter, SourceRetrievalResult } from "./sourceRetrievalAdapter";

// Phase 6H-9 — the one explicit, reusable entry point for triggering a real
// external retrieval (brief: "Implement the retrieval mechanism as a
// reusable service that can be explicitly invoked for an eligible
// registered source/entity. Do not build a scheduler... bulk retrieval...
// automatic regeneration... automatic publication."). This is the ONLY
// place a Studio Server Action should call into — never
// WikipediaSourceRetrievalAdapter directly — so the real adapter stays
// swappable (tests inject a fake-client-backed adapter) without touching
// call sites.
//
// Deliberately does not run on a timer, a webhook, or any other trigger —
// it runs once, synchronously, exactly when a Studio editor with
// CATALOGUE_WRITE explicitly asks for it (RBAC is enforced by the caller,
// e.g. the Source detail page's Server Action — this function itself has
// no session/permission concept, mirroring how generateRecordingEditorialSuggestion
// is not itself RBAC-aware).

const defaultAdapter: SourceRetrievalAdapter = new WikipediaSourceRetrievalAdapter();

export async function retrieveExternalSourceEvidence(
  sourceId: string,
  actorId: string,
  adapter: SourceRetrievalAdapter = defaultAdapter
): Promise<SourceRetrievalResult> {
  return adapter.retrieve({ sourceId, actorId });
}
