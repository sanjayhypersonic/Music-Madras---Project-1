import { createHash } from "crypto";
import type { RecordingContext } from "./recordingContextContract";

// Phase 6H-4 — the minimum mechanism for staleness detection (6H-2 §31):
// never a stored boolean, never a background job, never a second copy of
// the context. A ContentGenerationRequest stores exactly this string
// (`contextFingerprint`); a future caller re-assembles the current
// RecordingContext and compares fingerprints to learn whether anything the
// suggestion was based on has since changed.
//
// The Recording Context Assembler (Phase 6H-3) already guarantees every
// list inside RecordingContext is deterministically ordered (§43 of
// docs/content-intelligence-architecture.md), so a stable JSON
// serialization of the whole context is itself already deterministic —
// identical canonical state always serializes identically, and any
// meaningful change (a new work, an edited biography, a changed YouTube
// description, a newly attached Source) changes the serialized form and
// therefore the hash. No separate updatedAt-column bookkeeping is needed.
//
// Uses Node's built-in `crypto` — no new dependency, Prisma-free (ADR §3
// boundary rule: `crypto` is a language/runtime primitive, not a database
// access).
export function computeContextFingerprint(context: RecordingContext): string {
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}
