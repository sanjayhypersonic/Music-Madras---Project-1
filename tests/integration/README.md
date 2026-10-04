# tests/integration — runs against a DEDICATED test database

Per ADR §21: repository tests, the full draft→publish→re-edit→re-publish revision lifecycle, Sheet Music Request aggregation and the public pages run against a real PostgreSQL via Prisma.

**These tests create and delete rows, so they never run against the real Music Madras database.** `npm run test:integration` needs its own database, given by `TEST_DATABASE_URL`. There is no fallback to `DATABASE_URL`, and no override flag.

## Quick start (local PostgreSQL, no Docker, no cloud)

```bash
npm install
npm run test:integration:db:start    # starts a local PostgreSQL 17 for tests; prints the URL
```

Put the printed line in `.env.test` (gitignored), or export it in your shell:

```
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/music_madras_test
```

```bash
npm run test:integration:setup       # marks the (empty) database as a test database, applies the migrations
npm run test:integration             # the suite — prints the database it will use, then runs
```

Stop the local server with `npm run test:integration:db:stop`. Its data lives in `~/.music-madras/test-postgres` (override with `MM_TEST_DB_DIR`; port `54329`, override with `MM_TEST_DB_PORT`) — outside the repository, so it is never synced.

## Using another database (CI, a Neon branch)

Any dedicated Postgres works: set `TEST_DATABASE_URL` to it and run `npm run test:integration:setup` once.

- The database name must contain a `test` word (e.g. `music_madras_test`).
- On Neon use a **separate branch** (it has its own endpoint) with a database created for tests — never a second database on the production endpoint; the guard refuses that.
- Use a direct (non-pooled) URL. If `TEST_DATABASE_URL` is pooled, also set `TEST_DIRECT_URL` to the direct URL of the **same** database (one test, `syncRunLock`, needs a direct connection).
- **CI:** provide `TEST_DATABASE_URL` (for example a Postgres service container), run `npm run test:integration:setup`, then `npm run test:integration`. Nothing else is required: no production access, no Founder account, no catalogue data, no `.env`.

## How the real database is protected

The suite stops — before any test runs — unless every one of these holds:

1. `TEST_DATABASE_URL` is set (shell or `.env.test`). `.env` is never used to pick the target.
2. The environment is not production (`NODE_ENV` / `VERCEL_ENV`).
3. The database **name** contains a `test` word.
4. It is not the same server+port as any database configured in your `.env*` files (for a local server: not the same database). The real `.env` is only *parsed* to learn which databases are real.
5. At start-up the database carries the marker written by `test:integration:setup` (a database comment, written only onto an **empty** database) and has exactly this repository's migrations applied.

Each worker then runs with `DATABASE_URL`/`DIRECT_URL` replaced by the test database, the real `.env` unreadable (`DOTENV_CONFIG_PATH`), and every external service (YouTube, AI, email, analytics, Google sign-in) blanked, so a test can neither reach the real data nor spend a real API key. `tests/integration/setup/guardDatabase.ts` re-checks this inside every test file.

The run prints only the host and database name:

```
Integration database:
  127.0.0.1:54329 (local)
  database: music_madras_test
```

## Reset

```bash
npm run test:integration:reset       # drops the test schema and re-applies the migrations
```

`reset` refuses any database without the marker. Use it to clear everything a previous run left behind (see the audit-row note below).

## Troubleshooting

| Message | Meaning / fix |
|---|---|
| `Integration tests require TEST_DATABASE_URL` | Set it in `.env.test` or your shell (`npm run test:integration:db:start` prints a local one). |
| `does not look like a test database` | The database name needs a `test` word. |
| `same server ... as a configured real database` | `TEST_DATABASE_URL` points at the production server. Use a separate server or Neon branch. |
| `not marked as an integration-test database` / `schema has not been applied` | Run `npm run test:integration:setup` (an empty database). |
| `Cannot connect to the test database` | Start it: `npm run test:integration:db:start`. |
| `Migrations not applied` | Run `npm run test:integration:setup` after pulling new migrations. |
| `not marked ... and it already contains tables` | `setup` only marks an empty database. Create a fresh one. |

## Writing tests

Each test file creates its own clearly scoped fixtures (unique names/slugs, e.g. `tests/integration/credentialsSignIn.test.ts` uses `phase5c-integration-test@musicmadras.test`) and removes them afterwards. Tests are self-contained: they must not depend on the synced YouTube catalogue, the Founder account, or any pre-existing row — the test database starts empty.

`AuditLogEntry` has no FK/cascade on `entityId` by design (an intentionally generic, append-only polymorphic log — see `modules/audit/writeAuditLog.ts`), so a test that exercises a repository function which audit-logs should delete the audit rows it caused, scoped to the exact `entityId`(s) it created. Some older suites still leave such rows behind; that no longer pollutes anything that matters, because it happens only in the disposable test database, and `npm run test:integration:reset` clears it. Application code is never changed to make tests clean.

Test files run one at a time (`fileParallelism: false`): several count global tables before/after (Recording, Collection, MediaResource), which concurrent files in one database would disturb.
