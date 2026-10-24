import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { assessReadiness, readinessLogLine, type ReadinessFacts } from "../../modules/ops/readiness";
import type { AppliedMigrationRow } from "../../modules/ops/migrationPlan";
import { createWriteLimiter, describeRequestError, errorReasonCode, routeSubjectId, shouldReportRequestError } from "../../modules/ops/requestErrorReport";
import { OPERATIONAL_INCIDENT_KINDS, cleanIncident } from "../../modules/mmke/operations/operationalIncidents";

// Readiness (can this deployment serve real traffic?) and unhandled-error reporting (what may be logged and stored about a failure).

const done = (name: string): AppliedMigrationRow => ({ name, finishedAt: new Date(), rolledBackAt: null });
const facts = (rows: AppliedMigrationRow[] | null): ReadinessFacts => ({ databaseReachable: true, migrationRows: rows });

describe("assessReadiness", () => {
  const expected = ["001_a", "002_b"];
  it("is ready when the database answers and has every migration this release needs", () => {
    expect(assessReadiness(expected, facts([done("001_a"), done("002_b")]))).toEqual({ ready: true });
  });
  it("is NOT ready when the database is unreachable, the migration table cannot be read, a migration is pending, or one is failed", () => {
    expect(assessReadiness(expected, { databaseReachable: false })).toMatchObject({ ready: false, code: "DATABASE_UNREACHABLE" });
    expect(assessReadiness(expected, facts(null))).toMatchObject({ ready: false, code: "MIGRATIONS_UNREADABLE" });
    expect(assessReadiness(expected, facts([done("001_a")]))).toMatchObject({ ready: false, code: "MIGRATIONS_PENDING", detail: ["002_b"] });
    expect(assessReadiness(expected, facts([done("001_a"), { name: "002_b", finishedAt: null, rolledBackAt: null }]))).toMatchObject({ ready: false, code: "MIGRATION_FAILED" });
  });
  it("a database AHEAD of the release is ready (the normal state after returning to the previous release)", () => {
    expect(assessReadiness(expected, facts([done("001_a"), done("002_b"), done("999_future")]))).toEqual({ ready: true });
  });
  it("the log line is one JSON object with a code, and never anything but codes and migration names", () => {
    const line = readinessLogLine(assessReadiness(expected, facts([done("001_a")])));
    expect(JSON.parse(line)).toMatchObject({ level: "error", event: "readiness", ready: false, code: "MIGRATIONS_PENDING" });
    expect(JSON.parse(readinessLogLine({ ready: true }))).toMatchObject({ level: "info", ready: true });
  });
});

describe("the /api/ready route (source level)", () => {
  const route = readFileSync(path.resolve(__dirname, "../../app/api/ready/route.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  it("returns only a status word to the caller, never a code, a migration name or a database detail; is dynamic and uncacheable", () => {
    expect(route).toMatch(/export const dynamic = "force-dynamic"/);
    expect(route).toMatch(/"Cache-Control": "no-store"/);
    expect(route).not.toMatch(/result\.code|result\.detail|EXPECTED_MIGRATIONS\s*\)\s*,\s*\{/);
    expect(route.match(/Response\.json\(\{ status:/g)?.length).toBe(2);
    expect(route).toMatch(/console\.error\(readinessLogLine\(result\)\)/);
  });
  it("memoises the database check for seconds, so polling cannot become load on the database", () => {
    expect(route).toMatch(/READY_TTL_MS\s*=\s*5_000/);
    expect(route).toMatch(/NOT_READY_TTL_MS\s*=\s*1_000/);
  });
});

describe("unhandled-error reporting never leaks the request or the message", () => {
  const leaky = Object.assign(new Error("password=hunter2 at /var/app/secret.ts SELECT * FROM users WHERE email='a@b.c'"), { name: "PrismaClientKnownRequestError", digest: "1234567890" });

  it("only framework control-flow signals are ignored; real failures are reported", () => {
    expect(shouldReportRequestError(Object.assign(new Error("x"), { digest: "NEXT_NOT_FOUND" }))).toBe(false);
    expect(shouldReportRequestError(Object.assign(new Error("x"), { digest: "NEXT_REDIRECT;replace;/studio;307" }))).toBe(false);
    expect(shouldReportRequestError(Object.assign(new Error("x"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" }))).toBe(false);
    expect(shouldReportRequestError(Object.assign(new Error("x"), { name: "DynamicServerError" }))).toBe(false);
    expect(shouldReportRequestError(leaky)).toBe(true);
    expect(shouldReportRequestError("a thrown string")).toBe(true);
    expect(shouldReportRequestError(undefined)).toBe(true);
  });

  it("turns the error class into a bounded code in the incident alphabet; anything unusable becomes UNSPECIFIED", () => {
    expect(errorReasonCode(leaky)).toBe("PRISMA_CLIENT_KNOWN_REQUEST_ERROR");
    expect(errorReasonCode(new TypeError("x"))).toBe("TYPE_ERROR");
    expect(errorReasonCode("string")).toBe("UNSPECIFIED");
    expect(errorReasonCode({ name: "***" })).toBe("UNSPECIFIED");
    expect(errorReasonCode({ name: "A".repeat(200) })).toBe("UNSPECIFIED");
  });

  it("describes the failure by class, route PATTERN, kind and digest only: no message, stack, URL or header", () => {
    const safe = describeRequestError(leaky, { routePath: "/app/recordings/[slug]/page", routeType: "render" });
    expect(safe).toEqual({ event: "unhandled_server_error", errorName: "PrismaClientKnownRequestError", reasonCode: "PRISMA_CLIENT_KNOWN_REQUEST_ERROR", routeType: "render", route: "/app/recordings/[slug]/page", digest: "1234567890" });
    const json = JSON.stringify(safe);
    for (const secret of ["hunter2", "secret.ts", "SELECT", "a@b.c"]) expect(json).not.toContain(secret);
    // a hostile route string or digest is neutralised
    const hostile = describeRequestError(Object.assign(new Error("x"), { digest: "<script>" }), { routePath: "/app/x?token=abc def\nline", routeType: "weird" });
    expect(hostile.digest).toBeNull();
    expect(hostile.routeType).toBe("unknown");
    expect(hostile.route).not.toMatch(/\s|token=/);
  });

  it("builds a route identifier the incident log accepts, and the incident log accepts the new kind", () => {
    expect(routeSubjectId("/app/recordings/[slug]/page")).toBe("app-recordings-slug-page");
    expect(routeSubjectId("///")).toBeNull();
    expect(routeSubjectId(42)).toBeNull();
    expect(routeSubjectId(`/${"a".repeat(300)}`)!.length).toBeLessThanOrEqual(64);
    expect(Object.keys(OPERATIONAL_INCIDENT_KINDS)).toContain("UNHANDLED_SERVER_ERROR");
    expect(cleanIncident({ kind: "UNHANDLED_SERVER_ERROR", reasonCode: "TYPE_ERROR", subject: { type: "Route", id: routeSubjectId("/app/x/[id]/page")! } })).toEqual({ kind: "UNHANDLED_SERVER_ERROR", reasonCode: "TYPE_ERROR", subjectType: "Route", subjectId: "app-x-id-page" });
  });

  it("an error storm is limited to a bounded number of incident writes per window", () => {
    let now = 0;
    const allow = createWriteLimiter(3, 1000, () => now);
    expect([allow(), allow(), allow(), allow(), allow()]).toEqual([true, true, true, false, false]);
    now = 1500;
    expect(allow()).toBe(true);
  });

  it("the framework hook is wired: Node runtime only, never throws, goes through the safe reporter", () => {
    const src = readFileSync(path.resolve(__dirname, "../../instrumentation.ts"), "utf8");
    expect(src).toMatch(/export async function onRequestError/);
    expect(src).toMatch(/NEXT_RUNTIME !== "nodejs"\) return/);
    const reporter = readFileSync(path.resolve(__dirname, "../../modules/ops/reportRequestError.ts"), "utf8");
    expect(reporter).toMatch(/try \{[\s\S]*\} catch \{/);
    expect(reporter.replace(/\/\/.*$/gm, "")).not.toMatch(/\.message|\.stack|request\.|headers/);
  });
});
