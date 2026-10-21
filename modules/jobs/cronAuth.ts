import { createHash, timingSafeEqual } from "crypto";

// Phase 6K fix (F7) — authentication of the scheduled-maintenance endpoint. Hosting-neutral: ANY scheduler (a platform cron, an external service, an
// operator's script) calls the endpoint with `Authorization: Bearer <CRON_SECRET>`. The secret lives only in the deployment environment.
//
//  - Unset or weak secret → the endpoint is DISABLED (503). It never runs unauthenticated, and never "fails open".
//  - Wrong, missing or malformed credentials → 401 with no detail about why.
//  - The comparison is constant-time (digests of equal length), so response timing reveals nothing about the secret.
//  - The secret is never logged, echoed or placed in a response.

export const MIN_CRON_SECRET_LENGTH = 32;

export type CronAuthResult = { ok: true } | { ok: false; status: 401 | 503 };

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function authoriseCronRequest(authorizationHeader: string | null, env: Record<string, string | undefined> = process.env): CronAuthResult {
  const secret = env.CRON_SECRET?.trim();
  if (!secret || secret.length < MIN_CRON_SECRET_LENGTH) return { ok: false, status: 503 };
  if (!authorizationHeader) return { ok: false, status: 401 };
  const match = /^Bearer ([^\s]+)$/.exec(authorizationHeader.trim());
  if (!match) return { ok: false, status: 401 };
  return timingSafeEqual(digest(match[1]), digest(secret)) ? { ok: true } : { ok: false, status: 401 };
}