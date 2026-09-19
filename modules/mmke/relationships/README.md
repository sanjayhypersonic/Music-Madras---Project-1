# modules/mmke/relationships — later-phase scope

Structural placeholder for relationship-traversal helpers (e.g. "internal links generated from real MMKE relationships," ADR §19/§36) that are meaningful once real Museum pages exist to link between. All actual relationships are already modeled as real foreign keys and join tables in `prisma/schema.prisma` (Phase 1) — this directory is for higher-level query helpers built on top of those, not a place for duplicating the relationships themselves.
