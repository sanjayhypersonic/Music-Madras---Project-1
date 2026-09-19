# tests/integration — requires a provisioned database

Per ADR §21: repository tests, the full draft→publish→re-edit→re-publish revision lifecycle, and Sheet Music Request aggregation, run against a real (disposable-schema) Postgres database via Prisma.

No database has been provisioned in Phase 1 (guardrail: do not create external databases), so no integration tests are written yet — writing them against a database that doesn't exist would mean they either don't run or are superficial. Add real tests here once a Neon (or other) Postgres connection exists.
