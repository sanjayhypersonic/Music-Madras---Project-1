# modules/mmke/duplicate-detection

**Implemented (Phase 2):** `detectDuplicateName.ts` — exact-normalized-match duplicate prevention (trim/lowercase/collapse-whitespace comparison), pure and DB-free, tested in `tests/unit/`. Used by repositories such as `composerRepository.createComposer` before inserting a new row.

**Still deferred (later phase):** fuzzy/similarity matching (e.g. catching "J.S. Bach" as a likely duplicate of "Johann Sebastian Bach") needs a real similarity strategy — trigram matching via Postgres `pg_trgm` is the ADR's stated choice (§8) — and is only meaningfully buildable/testable against a live database and a real Studio entity-picker UX (brief §42), neither of which exist yet.
