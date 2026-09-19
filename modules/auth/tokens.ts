import { randomBytes, createHash } from "crypto";

// Shared token generation for invitations and password resets (ADR §7.2,
// §7.4). Only the hash is ever persisted — the raw token exists only in
// the invite/reset link at issuance time, exactly like the
// YouTubeAnalyticsObservation dimensions-hash pattern established in
// Phase 3. Node's built-in `crypto` only — no new dependency.

export function generateRawToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
