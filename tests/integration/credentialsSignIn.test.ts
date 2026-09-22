import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { hashPassword, verifyPassword } from "../../modules/auth/passwordHashing";
import { studioAuthAdapter } from "../../modules/auth/studioAuthAdapter";
import {
  deleteAllSessionsForUser,
  deleteStudioSession,
  findStudioUserByEmail,
} from "../../modules/db/repositories/studioAuthRepository";
import { updateStudioUserPassword } from "../../modules/db/repositories/studioUserAdminRepository";

// Phase 5C: real, disposable-fixture integration tests against the
// configured development Postgres database (see tests/integration/README.md
// — this is exactly what that file said would be added once a real
// connection existed). These exercise the credential-verification and
// database-session mechanics that a pure-function unit test cannot:
// modules/auth/credentialsSignIn.ts is intentionally thin glue around
// real repository/adapter calls, so the thing actually worth testing is
// whether those calls round-trip through Postgres correctly — not
// re-testing argon2 or Prisma themselves.
//
// modules/auth/credentialsSignIn.ts itself calls next/headers's cookies(),
// which throws outside a request context — so these tests call the
// password-verification step directly (the same functions
// credentialsSignIn.ts calls: findStudioUserByEmail + verifyPassword) and
// exercise session creation/reading/revocation through the same
// repository and adapter functions credentialsSignIn.ts and Auth.js's own
// database-session read path use, rather than importing
// signInWithStudioCredentials itself. This test suite runs separately via
// `npm run test:integration` (vitest.integration.config.ts) — never as
// part of the default `npm test`, which must stay usable without a
// database.

const TEST_EMAIL = "phase5c-integration-test@musicmadras.test";
const TEST_PASSWORD = "correct-horse-battery-staple";

async function createTestUser(status: "ACTIVE" | "DISABLED" | "INVITED", withPassword = true) {
  const id = randomUUID();
  return prisma.studioUser.create({
    data: {
      id,
      email: TEST_EMAIL,
      name: "Phase 5C Test User",
      role: "EDITOR",
      status,
      passwordHash: withPassword ? await hashPassword(TEST_PASSWORD) : null,
    },
  });
}

async function verifyCredentials(email: string, password: string) {
  // Mirrors modules/auth/credentialsSignIn.ts's own check exactly,
  // without the cookies()/createStudioSession side effects, so tests can
  // assert on the verification step and the session step independently.
  const user = await findStudioUserByEmail(email);
  if (!user || user.status !== "ACTIVE" || !user.passwordHash) return null;
  const matches = await verifyPassword(user.passwordHash, password);
  return matches ? user : null;
}

describe("Phase 5C credentials + database session flow", () => {
  afterEach(async () => {
    // Cleanup order respects FK constraints: sessions before the user.
    // Also removes this test's own AuditLogEntry rows (Phase 6F database
    // hygiene) — test H calls updateStudioUserPassword, which audit-logs
    // by design (ADR §20: password changes are a real, meaningful event
    // in production). That's correct behavior to exercise, but without
    // this cleanup the row outlives the test user it references (audit
    // rows have no FK/cascade on entityId, by design — see
    // modules/audit/writeAuditLog.ts) and accumulates in the dev database
    // every time this suite runs. Scoped only to this exact test user's
    // id, so it can never touch a real StudioUser's audit history.
    const user = await prisma.studioUser.findUnique({ where: { email: TEST_EMAIL } });
    if (user) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "StudioUser", entityId: user.id } });
      await prisma.studioSession.deleteMany({ where: { studioUserId: user.id } });
      await prisma.studioUser.delete({ where: { id: user.id } });
    }
  });

  it("A: valid credentials are found and verified, and a StudioSession can be created for them", async () => {
    const created = await createTestUser("ACTIVE");

    const verified = await verifyCredentials(TEST_EMAIL, TEST_PASSWORD);
    expect(verified?.id).toBe(created.id);

    const session = await studioAuthAdapter.createSession!({
      sessionToken: randomUUID(),
      userId: created.id,
      expires: new Date(Date.now() + 60_000),
    });
    expect(session.userId).toBe(created.id);

    const rows = await prisma.studioSession.findMany({ where: { studioUserId: created.id } });
    expect(rows).toHaveLength(1);
  });

  it("B: an invalid password is rejected and no session is created", async () => {
    const created = await createTestUser("ACTIVE");

    const verified = await verifyCredentials(TEST_EMAIL, "the-wrong-password");
    expect(verified).toBeNull();

    const rows = await prisma.studioSession.findMany({ where: { studioUserId: created.id } });
    expect(rows).toHaveLength(0);
  });

  it("C: an unknown email is rejected", async () => {
    const verified = await verifyCredentials("no-such-account@musicmadras.test", TEST_PASSWORD);
    expect(verified).toBeNull();
  });

  it("D: a DISABLED account is rejected even with the correct password", async () => {
    await createTestUser("DISABLED");

    const verified = await verifyCredentials(TEST_EMAIL, TEST_PASSWORD);
    expect(verified).toBeNull();
  });

  it("D: an INVITED account with no password set is rejected", async () => {
    await createTestUser("INVITED", /* withPassword */ false);

    const verified = await verifyCredentials(TEST_EMAIL, TEST_PASSWORD);
    expect(verified).toBeNull();
  });

  it("E: a session created this way is resolvable through the same adapter method Auth.js's database-session read path uses", async () => {
    const created = await createTestUser("ACTIVE");
    const sessionToken = randomUUID();
    await studioAuthAdapter.createSession!({
      sessionToken,
      userId: created.id,
      expires: new Date(Date.now() + 60_000),
    });

    const result = await studioAuthAdapter.getSessionAndUser!(sessionToken);
    expect(result?.user.email).toBe(TEST_EMAIL);
    expect(result?.session.userId).toBe(created.id);
  });

  it("F: deleting the session (what sign-out does) makes it unresolvable", async () => {
    const created = await createTestUser("ACTIVE");
    const sessionToken = randomUUID();
    await studioAuthAdapter.createSession!({
      sessionToken,
      userId: created.id,
      expires: new Date(Date.now() + 60_000),
    });

    await deleteStudioSession(sessionToken);

    const result = await studioAuthAdapter.getSessionAndUser!(sessionToken);
    expect(result).toBeNull();
  });

  it("G: revoking all sessions for a user (disable/role-change path) makes an existing session unresolvable", async () => {
    const created = await createTestUser("ACTIVE");
    const sessionToken = randomUUID();
    await studioAuthAdapter.createSession!({
      sessionToken,
      userId: created.id,
      expires: new Date(Date.now() + 60_000),
    });

    await deleteAllSessionsForUser(created.id);

    const result = await studioAuthAdapter.getSessionAndUser!(sessionToken);
    expect(result).toBeNull();
  });

  it("H: changing a user's password revokes their existing sessions", async () => {
    const created = await createTestUser("ACTIVE");
    const sessionToken = randomUUID();
    await studioAuthAdapter.createSession!({
      sessionToken,
      userId: created.id,
      expires: new Date(Date.now() + 60_000),
    });

    await updateStudioUserPassword(created.id, await hashPassword("a-brand-new-password"));

    const result = await studioAuthAdapter.getSessionAndUser!(sessionToken);
    expect(result).toBeNull();
  });
});
