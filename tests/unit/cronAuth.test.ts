import { describe, expect, it } from "vitest";
import { MIN_CRON_SECRET_LENGTH, authoriseCronRequest } from "../../modules/jobs/cronAuth";

// F7 — authentication of the scheduled-maintenance endpoint. Synthetic secrets only.

const SECRET = "synthetic-cron-secret-0123456789-abcdefghij";
const env = { CRON_SECRET: SECRET };

describe("authoriseCronRequest", () => {
  it("accepts exactly the configured secret as a Bearer token", () => {
    expect(authoriseCronRequest(`Bearer ${SECRET}`, env)).toEqual({ ok: true });
    expect(authoriseCronRequest(`  Bearer ${SECRET}  `, env)).toEqual({ ok: true }); // surrounding whitespace is tolerated
  });

  it("is DISABLED (503), never open, when the secret is unset, blank or too short — even for a request that presents something", () => {
    for (const secret of [undefined, "", "   ", "short", "x".repeat(MIN_CRON_SECRET_LENGTH - 1)]) {
      expect(authoriseCronRequest(`Bearer ${secret ?? ""}`, { CRON_SECRET: secret }), JSON.stringify(secret)).toEqual({ ok: false, status: 503 });
      expect(authoriseCronRequest(null, { CRON_SECRET: secret })).toEqual({ ok: false, status: 503 });
    }
    expect(authoriseCronRequest(`Bearer ${SECRET}`, {})).toEqual({ ok: false, status: 503 });
  });

  it("refuses (401) a missing, malformed or wrong credential, with no detail", () => {
    for (const header of [null, "", "Bearer", "Bearer ", SECRET, `Basic ${SECRET}`, `bearer ${SECRET}`, `Bearer ${SECRET}x`, `Bearer x${SECRET}`, `Bearer ${SECRET.toUpperCase()}`, `Bearer ${SECRET} extra`, `Bearer ${"a".repeat(500)}`]) {
      expect(authoriseCronRequest(header, env), String(header)).toEqual({ ok: false, status: 401 });
    }
  });

  it("returns only a status — nothing that could echo the secret or the presented value", () => {
    const wrong = authoriseCronRequest("Bearer not-the-secret-not-the-secret-not-the-secret", env);
    expect(JSON.stringify(wrong)).not.toContain(SECRET);
    expect(JSON.stringify(wrong)).not.toContain("not-the-secret");
    expect(Object.keys(wrong).sort()).toEqual(["ok", "status"]);
  });

  it("takes comparable time whatever the length of a wrong token (digests of equal length are compared)", () => {
    // Behavioural guard rather than a timing measurement: very short and very long wrong tokens are both rejected cleanly without throwing.
    for (const token of ["a", "a".repeat(1_000_000)]) expect(authoriseCronRequest(`Bearer ${token}`, env)).toEqual({ ok: false, status: 401 });
  });
});
