import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import {
  AUTH_ATTEMPT_ENTITY_TYPE,
  AUTH_AUDIT_ACTIONS,
  RESET_REQUEST_WINDOW_MS,
  SIGN_IN_WINDOW_MS,
  attemptKey,
} from "../../auth/authRateLimit";

// Phase 6J-1 — the attempt log behind Studio's sign-in / reset rate limits
// (modules/auth/authRateLimit.ts). Attempts are append-only AuditLogEntry rows
// (entityType "AuthAttempt", entityId = SHA-256 of the email), so there is no
// new table and the trail doubles as the missing sign-in audit.

export async function recordSignInFailure(email: string): Promise<void> {
  await writeAuditLog({ actorId: null, action: AUTH_AUDIT_ACTIONS.signInFailed, entityType: AUTH_ATTEMPT_ENTITY_TYPE, entityId: attemptKey(email) });
}

export async function recordSignInSuccess(email: string, userId: string): Promise<void> {
  await writeAuditLog({ actorId: userId, action: AUTH_AUDIT_ACTIONS.signInSucceeded, entityType: AUTH_ATTEMPT_ENTITY_TYPE, entityId: attemptKey(email) });
}

export async function recordResetRequest(email: string): Promise<void> {
  await writeAuditLog({ actorId: null, action: AUTH_AUDIT_ACTIONS.resetRequested, entityType: AUTH_ATTEMPT_ENTITY_TYPE, entityId: attemptKey(email) });
}

/** Failed sign-ins for this email since the later of "15 minutes ago" and the last successful sign-in. */
export async function countRecentSignInFailures(email: string, now: Date = new Date()): Promise<number> {
  const entityId = attemptKey(email);
  const windowStart = new Date(now.getTime() - SIGN_IN_WINDOW_MS);

  const lastSuccess = await prisma.auditLogEntry.findFirst({
    where: { entityType: AUTH_ATTEMPT_ENTITY_TYPE, entityId, action: AUTH_AUDIT_ACTIONS.signInSucceeded, timestamp: { gte: windowStart } },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  });

  return prisma.auditLogEntry.count({
    where: {
      entityType: AUTH_ATTEMPT_ENTITY_TYPE,
      entityId,
      action: AUTH_AUDIT_ACTIONS.signInFailed,
      timestamp: { gt: lastSuccess?.timestamp ?? windowStart },
    },
  });
}

export async function countRecentResetRequests(email: string, now: Date = new Date()): Promise<number> {
  return prisma.auditLogEntry.count({
    where: {
      entityType: AUTH_ATTEMPT_ENTITY_TYPE,
      entityId: attemptKey(email),
      action: AUTH_AUDIT_ACTIONS.resetRequested,
      timestamp: { gte: new Date(now.getTime() - RESET_REQUEST_WINDOW_MS) },
    },
  });
}
