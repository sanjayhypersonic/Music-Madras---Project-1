import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAlertPayload, parseAlertConfig, resetAlertCooldowns, sendOperatorAlert, type OperatorAlert } from "../../modules/ops/operatorAlert";

// A webhook URL is a secret: these tests pin that it is validated without being echoed, that the message is built only from bounded facts, that nothing is sent
// without a valid destination, that repeats are limited, and that no failure can raise or leak the URL.

const SECRET_PATH = "T00000/B00000/xoxb-super-secret-token";
const URL_OK = `https://hooks.example.com/services/${SECRET_PATH}`;
const alert: OperatorAlert = { kind: "UNHANDLED_SERVER_ERROR", code: "PRISMA_CLIENT_KNOWN_REQUEST_ERROR", route: "/app/recordings/[slug]/page", dedupeKey: "k1" };
const now = new Date("2026-10-25T10:00:00.000Z");

beforeEach(() => resetAlertCooldowns());

describe("parseAlertConfig", () => {
  it("unset and blank are UNSET", () => {
    expect(parseAlertConfig({}).state).toBe("UNSET");
    expect(parseAlertConfig({ ALERT_WEBHOOK_URL: "   " }).state).toBe("UNSET");
  });

  it("accepts an https URL and exposes only its host for display", () => {
    const config = parseAlertConfig({ ALERT_WEBHOOK_URL: URL_OK });
    expect(config).toMatchObject({ state: "READY", host: "hooks.example.com" });
  });

  it.each([
    ["not a URL", "nonsense"],
    ["http", "http://hooks.example.com/x"],
    ["credentials in the URL", "https://user:pass@hooks.example.com/x"],
    ["localhost", "https://localhost/x"],
    ["loopback", "https://127.0.0.1/x"],
    ["a .localhost name", "https://alerts.localhost/x"],
  ])("rejects %s, and the reason never contains the value", (_label, value) => {
    const config = parseAlertConfig({ ALERT_WEBHOOK_URL: value });
    expect(config.state).toBe("INVALID");
    expect(JSON.stringify(config)).not.toContain(value);
  });
});

describe("buildAlertPayload", () => {
  it("is built from bounded facts and names the environment's host", () => {
    const payload = buildAlertPayload(alert, { PUBLIC_SITE_URL: "https://www.musicmadras.example" }, now);
    expect(payload).toMatchObject({ event: "operator_alert", kind: "UNHANDLED_SERVER_ERROR", code: "PRISMA_CLIENT_KNOWN_REQUEST_ERROR", route: "/app/recordings/[slug]/page", site: "www.musicmadras.example", occurredAt: now.toISOString() });
    expect(payload.text).toContain("www.musicmadras.example");
    expect(payload.content).toBe(payload.text);
  });

  it("drops a code or route outside the safe alphabet instead of passing free text through", () => {
    const payload = buildAlertPayload({ ...alert, code: "bad code with spaces & secrets", route: "/recordings/real-slug?token=abc def" }, {}, now);
    expect(payload.code).toBe("UNSPECIFIED");
    expect(payload.route).toBeNull();
    expect(JSON.stringify(payload)).not.toMatch(/secrets|token|abc/);
  });

  it("never contains the webhook URL or any other environment value", () => {
    const env = { ALERT_WEBHOOK_URL: URL_OK, AUTH_SECRET: "super-secret-auth-value", DATABASE_URL: "postgresql://u:p@db.example.com/x", PUBLIC_SITE_URL: "https://site.example.com" };
    const text = JSON.stringify(buildAlertPayload(alert, env, now));
    for (const secret of [SECRET_PATH, "super-secret-auth-value", "db.example.com", "u:p"]) expect(text).not.toContain(secret);
  });
});

describe("sendOperatorAlert", () => {
  const env = { ALERT_WEBHOOK_URL: URL_OK, PUBLIC_SITE_URL: "https://site.example.com" };
  const ok = () => vi.fn(async () => new Response("ok", { status: 200 }));

  it("sends nothing, and calls nothing, when no destination is configured or it is invalid", async () => {
    const fetchMock = ok();
    expect(await sendOperatorAlert(alert, { env: {}, fetch: fetchMock as never, now: () => now })).toBe("UNCONFIGURED");
    expect(await sendOperatorAlert(alert, { env: { ALERT_WEBHOOK_URL: "http://insecure.example.com" }, fetch: fetchMock as never, now: () => now })).toBe("UNCONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs one JSON document to the configured URL, without following redirects", async () => {
    const fetchMock = ok();
    expect(await sendOperatorAlert(alert, { env, fetch: fetchMock as never, now: () => now })).toBe("SENT");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_OK);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body as string)).toMatchObject({ event: "operator_alert", kind: "UNHANDLED_SERVER_ERROR" });
  });

  it("limits repeats of the same key to one per cooldown, per key, and sends again afterwards", async () => {
    const fetchMock = ok();
    let t = now.getTime();
    const deps = { env, fetch: fetchMock as never, now: () => new Date(t), cooldownMs: 600_000 };
    expect(await sendOperatorAlert(alert, deps)).toBe("SENT");
    expect(await sendOperatorAlert(alert, deps)).toBe("COOLDOWN");
    expect(await sendOperatorAlert({ ...alert, dedupeKey: "k2" }, deps)).toBe("SENT");
    t += 600_001;
    expect(await sendOperatorAlert(alert, deps)).toBe("SENT");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("concurrent identical alerts send once (the cooldown is claimed before the request)", async () => {
    const fetchMock = ok();
    const deps = { env, fetch: fetchMock as never, now: () => now };
    const results = await Promise.all([sendOperatorAlert(alert, deps), sendOperatorAlert(alert, deps), sendOperatorAlert(alert, deps)]);
    expect(results.filter((r) => r === "SENT")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a refusing destination is FAILED, logged by status class only, and is retried only after the back-off (not on every poll)", async () => {
    const lines: string[] = [];
    const refuse = vi.fn(async () => new Response("denied", { status: 403 }));
    expect(await sendOperatorAlert(alert, { env, fetch: refuse as never, now: () => now, log: (l) => lines.push(l) })).toBe("FAILED");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ level: "error", event: "operator_alert_failed", kind: "UNHANDLED_SERVER_ERROR", httpClass: "4xx" });
    expect(await sendOperatorAlert(alert, { env, fetch: ok() as never, now: () => now })).toBe("COOLDOWN"); // a dead destination is not hammered by a polled probe
    const later = new Date(now.getTime() + 61_000);
    expect(await sendOperatorAlert(alert, { env, fetch: ok() as never, now: () => later })).toBe("SENT"); // but it is not stuck for the whole cooldown either
  });

  it("a network error never throws, and the log line contains neither the URL nor the message", async () => {
    const lines: string[] = [];
    const boom = vi.fn(async () => {
      throw new TypeError(`connect ECONNREFUSED ${URL_OK}`);
    });
    expect(await sendOperatorAlert(alert, { env, fetch: boom as never, now: () => now, log: (l) => lines.push(l) })).toBe("FAILED");
    expect(lines.join("")).not.toContain(SECRET_PATH);
    expect(lines.join("")).not.toContain("ECONNREFUSED");
    expect(JSON.parse(lines[0])).toMatchObject({ event: "operator_alert_failed", errorName: "TypeError" });
  });

  it("a destination that never answers is abandoned after the timeout", async () => {
    const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    const started = Date.now();
    expect(await sendOperatorAlert(alert, { env, fetch: hang as never, now: () => now, timeoutMs: 40, log: () => undefined })).toBe("FAILED");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("even a throwing logger cannot make it throw", async () => {
    const boom = vi.fn(async () => {
      throw new Error("x");
    });
    await expect(sendOperatorAlert(alert, { env, fetch: boom as never, now: () => now, log: () => { throw new Error("logger broke"); } })).resolves.toBe("FAILED");
  });
});
