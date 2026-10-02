// Phase 6I-3 — the single pure rule for "is this suggestion still current",
// extracted from contentSuggestionRepository.checkContentSuggestionFreshness
// (6H-2 §31/§41) so the per-suggestion check and the Editorial Operations
// Queue (which compares one freshly assembled fingerprint per Recording
// against many suggestions) can never disagree.
//
//   no fingerprint was ever stored        -> UNKNOWN
//   the current context cannot be built   -> UNKNOWN (e.g. never published, archived since)
//   fingerprints equal                    -> CURRENT
//   fingerprints differ                   -> STALE
//
// Pure: no database, no assembly, no side effects.

export type ContentSuggestionFreshness = "CURRENT" | "STALE" | "UNKNOWN";

export function deriveContentSuggestionFreshness(
  storedFingerprint: string | null,
  currentFingerprint: string | null
): ContentSuggestionFreshness {
  if (!storedFingerprint || !currentFingerprint) return "UNKNOWN";
  return storedFingerprint === currentFingerprint ? "CURRENT" : "STALE";
}
