import { beforeEach, describe, expect, it, vi } from "vitest";

// Where the operator alert is raised from: the unhandled-error hook, the readiness probe and the scheduled-maintenance endpoint. The incident repository, the job and the
// network are replaced; the alert module itself is the real one with a fake fetch, so the whole path from event to outgoing message is exercised.

const record = vi.hoisted(() => vi.fn());
vi.mock("../../modules/db/repositories/operationalIncidentRepository", () => ({ recordOperationalIncidentSafely: record }));
const facts = vi.hoisted(() => vi.fn());
vi.mock("../../modules/db/repositories/readinessRepository", () => ({ loadReadinessFacts: facts }));
const job = vi.hoisted(() => vi.fn());
vi.mock("../../modules/jobs/stewardshipJob", () => ({ runStewardshipJob: job }));

import { resetAlertCooldowns } from "../../modules/ops/operatorAlert";
import { reportRequestError } from "../../modules/ops/reportRequestError";

const SECRET_PATH = "T1/B1/very-secret-webhook-token";
const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
  sent.push({ url, body: JSON.parse(init.body as string) });
  return new Response("ok", { status: 200 });
});

beforeEach(() => {
  resetAlertCooldowns();
  sent.length = 0;
  record.mockReset();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ALERT_WEBHOOK_URL", `https://hooks.example.com/${SECRET_PATH}`);
  vi.stubEnv("PUBLIC_SITE_URL", "https://site.example.com");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const dbError = Object.assign(new Error("connection to 10.0.0.5 refused for user admin"), { name: "PrismaClientInitializationError" });

describe("unhandled server errors", () => {
  it("alert on the FIRST occurrence (a new incident) with only the code and route pattern", async () => {
    record.mockResolvedValue({ id: "i1", created: true, occurrenceCount: 1, notificationEvaluated: false });
    await reportRequestError(dbError, { routePath: "/recordings/[slug]", routeType: "render" });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toContain(SECRET_PATH);
    expect(sent[0].body).toMatchObject({ kind: "UNHANDLED_SERVER_ERROR", code: "PRISMA_CLIENT_INITIALIZATION_ERROR", route: "/recordings/[slug]" });
    expect(JSON.stringify(sent[0].body)).not.toMatch(/10\.0\.0\.5|admin|refused|very-secret/);
  });

  it("do not alert again for a repeat of a known incident (the incident row is the memory)", async () => {
    record.mockResolvedValue({ id: "i1", created: false, occurrenceCount: 2, notificationEvaluated: false });
    await reportRequestError(dbError, { routePath: "/recordings/[slug]", routeType: "render" });
    expect(sent).toHaveLength(0);
  });

  it("alert when the incident cannot be recorded at all (the database is the problem), once per cooldown", async () => {
    record.mockResolvedValue(null);
    await reportRequestError(dbError, { routePath: "/recordings/[slug]", routeType: "render" });
    await reportRequestError(dbError, { routePath: "/recordings/[slug]", routeType: "render" });
    expect(sent).toHaveLength(1);
  });

  it("never alert for the framework's control flow (notFound, redirect)", async () => {
    record.mockResolvedValue(null);
    await reportRequestError(Object.assign(new Error("x"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" }), { routePath: "/x" });
    await reportRequestError(Object.assign(new Error("x"), { digest: "NEXT_REDIRECT;replace;/a;307;" }), { routePath: "/x" });
    expect(sent).toHaveLength(0);
    expect(record).not.toHaveBeenCalled();
  });

  it("do nothing outward, and do not fail, when no alert destination is configured", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "");
    record.mockResolvedValue({ id: "i1", created: true, occurrenceCount: 1, notificationEvaluated: false });
    await expect(reportRequestError(dbError, { routePath: "/x" })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("do not fail, and do not leak, when the alert destination is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError(`getaddrinfo ENOTFOUND hooks.example.com/${SECRET_PATH}`); }));
    record.mockResolvedValue({ id: "i1", created: true, occurrenceCount: 1, notificationEvaluated: false });
    await expect(reportRequestError(dbError, { routePath: "/x" })).resolves.toBeUndefined();
    const logged = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).not.toContain(SECRET_PATH);
  });
});

describe("readiness probe", () => {
  it("alerts once with the code only when the database is unreachable, and not when ready", async () => {
    const { GET } = await import("../../app/api/ready/route");
    facts.mockResolvedValue({ databaseReachable: false });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "not-ready" });
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({ kind: "NOT_READY", code: "DATABASE_UNREACHABLE" });
  });
});

describe("scheduled maintenance endpoint", () => {
  it("declares that a run may take up to a minute (the job's own bound is 40 s of sweeps plus the email step)", async () => {
    const mod = await import("../../app/api/cron/stewardship/route");
    expect(mod.maxDuration).toBeGreaterThanOrEqual(60);
    expect(mod.dynamic).toBe("force-dynamic");
  });

  const CRON_SECRET = "c".repeat(40);
  const call = async (header?: string) => {
    const { POST } = await import("../../app/api/cron/stewardship/route");
    return POST(new Request("https://site.example.com/api/cron/stewardship", { method: "POST", headers: header ? { authorization: header } : {} }));
  };

  it("is disabled (503) without a sufficiently long secret, and runs nothing", async () => {
    vi.stubEnv("CRON_SECRET", "");
    job.mockReset();
    expect((await call(`Bearer ${CRON_SECRET}`)).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "too-short");
    expect((await call("Bearer too-short")).status).toBe(503);
    expect(job).not.toHaveBeenCalled();
  });

  it("refuses missing or wrong credentials (401) without running or alerting", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    job.mockReset();
    expect((await call()).status).toBe(401);
    expect((await call(`Bearer ${"d".repeat(40)}`)).status).toBe(401);
    expect((await call(CRON_SECRET)).status).toBe(401);
    expect(job).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("a fully successful run answers 200 and sends no alert", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    job.mockResolvedValue({ ok: true, ran: true, status: "SUCCEEDED", steps: [] });
    const response = await call(`Bearer ${CRON_SECRET}`);
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it("a run that did not fully succeed answers 500 and alerts once per cooldown; the response never contains a secret", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    job.mockResolvedValue({ ok: false, ran: true, status: "PARTIAL", steps: [] });
    const first = await call(`Bearer ${CRON_SECRET}`);
    await call(`Bearer ${CRON_SECRET}`);
    expect(first.status).toBe(500);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({ kind: "MAINTENANCE_FAILED", code: "STEWARDSHIP_NOT_SUCCEEDED" });
    expect(JSON.stringify(await first.json())).not.toContain(CRON_SECRET);
  });

  it("a run that cannot even be recorded answers 500 with the kind of failure only, and alerts", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    job.mockRejectedValue(new Error("password authentication failed for user admin at 10.0.0.5"));
    const response = await call(`Bearer ${CRON_SECRET}`);
    expect(response.status).toBe(500);
    const text = JSON.stringify(await response.json());
    expect(text).not.toMatch(/10\.0\.0\.5|admin|password/);
    expect(sent.map((s) => s.body.code)).toEqual(["STEWARDSHIP_NOT_RECORDED"]);
  });
});
