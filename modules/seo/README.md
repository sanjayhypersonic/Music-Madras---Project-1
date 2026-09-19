# modules/seo — later-phase scope

Structural placeholder. Per ADR §19, this module will reuse and adapt the legacy prototype's `legacy-prototype/src/lib/schemaStructuredData.ts` (JSON-LD generators) and `legacy-prototype/src/metadata.ts` (per-entity metadata generator) as `generateMetadata` implementations for the real Museum routes. That requires the Museum routes to exist first (a later phase) — not built in Phase 1.
