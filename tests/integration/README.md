# tests/integration — requires a reachable database

Per ADR §21: repository tests, the full draft→publish→re-edit→re-publish revision lifecycle, and Sheet Music Request aggregation, run against a real Postgres database via Prisma.

A development Neon Postgres database was provisioned in Phase 5A, so this is no longer just a placeholder. Run these with:

```bash
npm run test:integration
```

This uses `vitest.integration.config.ts`, a separate config from the default `npm test` — these tests need `DATABASE_URL`/`DIRECT_URL` configured and reachable, so they are never part of the default (DB-free) test run. Each test file is responsible for creating its own fixture rows (clearly scoped, e.g. `tests/integration/credentialsSignIn.test.ts` uses `phase5c-integration-test@musicmadras.test`) and deleting them in an `afterEach`, leaving the database exactly as it found it — never write tests here that touch real Studio accounts or catalogue data.

**AuditLogEntry rows too (Phase 6F).** `AuditLogEntry` has no FK/cascade on `entityId` by design (it's an intentionally generic, append-only polymorphic log — see `modules/audit/writeAuditLog.ts`), so a test that exercises a repository function which audit-logs (e.g. `setFieldOwnership`, `resolveSyncConflict`, `upsertSyncPolicy`, `recordObservabilityTransition`, `updateStudioUserPassword`) must also delete the `AuditLogEntry` rows it caused, in the same `afterEach`, scoped to the exact `entityId`(s) that test created. Otherwise those rows silently outlive the fixture that produced them and accumulate as orphaned noise in the development database every time the suite runs — see `docs/phase-6f-preflight.md` for how this was discovered and fixed.
