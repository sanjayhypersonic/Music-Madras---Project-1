// OPERATOR ALERT (launch readiness; project register R-15). The one mechanism the APPLICATION owns for telling a designated person that something critical is wrong,
// independent of any hosting provider: an HTTPS POST of a small JSON document to ALERT_WEBHOOK_URL (a Slack, Teams, Discord or paging-service incoming webhook, or any
// HTTPS endpoint that turns a POST into a message). It complements, and does not replace, the host's uptime monitor and log-drain alert rules (runbook section 8): those
// see a dead process and a dead database, which this cannot.
//
// Hard rules:
//   - the webhook URL is a SECRET (incoming-webhook URLs carry their credential in the path): it is never logged, returned, stored or put in a message; only its host
//     may be named. Configuration problems name the variable, never the value;
//   - the payload is built ONLY from bounded, already-sanitised facts (an alert kind, a code from a fixed alphabet, a route PATTERN, a time). Never an error message, a
//     stack, a URL of a request, a person, a title, a query or a header;
//   - sending never throws and never blocks a request for long (4 s timeout); a failure is one log line with the alert kind and a status class, nothing else;
//   - repeats are limited: callers pass a `dedupeKey`; a key is sent at most once per cooldown per instance (a database-backed incident supplies the cross-instance dedupe);
//   - nothing is sent unless ALERT_WEBHOOK_URL is set and valid, so development, tests and every deployment that has not chosen a destination send nothing.

export type AlertKind = "UNHANDLED_SERVER_ERROR" | "INCIDENT_RECURRING" | "NOT_READY" | "MAINTENANCE_FAILED" | "TEST";

export interface OperatorAlert {
  kind: AlertKind;
  /** A bounded code (A-Z, 0-9, underscore): what went wrong, never why in words. */
  code: string;
  /** A route PATTERN (never a concrete URL), when relevant. */
  route?: string | null;
  /** Repeats with the same key within the cooldown are not sent again by this instance. */
  dedupeKey: string;
}

export type AlertConfig = { state: "UNSET" } | { state: "INVALID"; reason: string } | { state: "READY"; url: string; host: string };

type Env = Readonly<Record<string, string | undefined>>;

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|::1|0\.0\.0\.0)$/i;

/** Pure. Decides whether ALERT_WEBHOOK_URL is usable. The reasons never include the value. */
export function parseAlertConfig(env: Env): AlertConfig {
  const raw = env.ALERT_WEBHOOK_URL?.trim();
  if (!raw) return { state: "UNSET" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { state: "INVALID", reason: "is not a valid URL." };
  }
  if (url.protocol !== "https:") return { state: "INVALID", reason: "must be an https:// URL (an alert must not travel in clear text)." };
  if (url.username || url.password) return { state: "INVALID", reason: "must not carry a user name or password in the URL (use the webhook's own token path)." };
  if (LOCAL.test(url.hostname) || url.hostname.endsWith(".localhost")) return { state: "INVALID", reason: "must not point at this machine; an alert destination has to be reachable by a person." };
  return { state: "READY", url: url.toString(), host: url.hostname };
}

const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_ROUTE = /^[A-Za-z0-9/_\[\]().?-]{1,120}$/;

const TITLES: Record<AlertKind, string> = {
  UNHANDLED_SERVER_ERROR: "Unhandled server error",
  INCIDENT_RECURRING: "Operational incident is recurring",
  NOT_READY: "Deployment is not ready to serve traffic",
  MAINTENANCE_FAILED: "Scheduled maintenance did not fully succeed",
  TEST: "Test alert (no action needed)",
};

export interface AlertPayload {
  text: string;
  content: string;
  event: "operator_alert";
  kind: AlertKind;
  code: string;
  route: string | null;
  site: string | null;
  occurredAt: string;
}

/** Pure. The whole message, from bounded facts only. `site` is the host of PUBLIC_SITE_URL when valid, so a person knows which environment is speaking. */
export function buildAlertPayload(alert: OperatorAlert, env: Env, now: Date): AlertPayload {
  const code = SAFE_CODE.test(alert.code) ? alert.code : "UNSPECIFIED";
  const route = alert.route && SAFE_ROUTE.test(alert.route) ? alert.route : null;
  let site: string | null = null;
  try {
    site = env.PUBLIC_SITE_URL ? new URL(env.PUBLIC_SITE_URL.trim()).hostname : null;
  } catch {
    site = null;
  }
  const text = `[Music Madras${site ? ` · ${site}` : ""}] ${TITLES[alert.kind]} (${code}${route ? `, ${route}` : ""}). Check Studio → Health and the host's logs.`;
  return { text, content: text, event: "operator_alert", kind: alert.kind, code, route, site, occurredAt: now.toISOString() };
}

export type AlertOutcome = "SENT" | "UNCONFIGURED" | "COOLDOWN" | "FAILED";

export interface AlertDeps {
  env?: Env;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  cooldownMs?: number;
  /** After a FAILED send, how long before the same key may try again (so a dead destination slows a polled probe once a minute, not on every poll). */
  failureRetryMs?: number;
  log?: (line: string) => void;
}

const MAX_KEYS = 200;
const lastSent = new Map<string, number>();

/** Test hook: forget every cooldown. */
export function resetAlertCooldowns(): void {
  lastSent.clear();
}

/** A failed send is retried by the next occurrence only after a short back-off: the key is re-armed to become sendable again `retryMs` from now. */
function backOff(key: string, nowMs: number, cooldownMs: number, retryMs: number = 60_000): void {
  lastSent.set(key, nowMs - Math.max(0, cooldownMs - retryMs));
}

/** Never throws. Returns what happened so callers and tests can see it; callers ignore it. */
export async function sendOperatorAlert(alert: OperatorAlert, deps: AlertDeps = {}): Promise<AlertOutcome> {
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((line: string) => console.error(line));
  try {
    const config = parseAlertConfig(env);
    if (config.state !== "READY") return "UNCONFIGURED";

    const now = (deps.now ?? (() => new Date()))();
    const cooldownMs = deps.cooldownMs ?? 10 * 60_000;
    const previous = lastSent.get(alert.dedupeKey);
    if (previous !== undefined && now.getTime() - previous < cooldownMs) return "COOLDOWN";
    if (lastSent.size >= MAX_KEYS) lastSent.delete(lastSent.keys().next().value as string);
    lastSent.set(alert.dedupeKey, now.getTime()); // claimed before the send, so a slow endpoint cannot be hit twice by a burst

    const payload = buildAlertPayload(alert, env, now);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 4000);
    try {
      const response = await (deps.fetch ?? fetch)(config.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal, redirect: "error" });
      if (!response.ok) {
        backOff(alert.dedupeKey, now.getTime(), cooldownMs, deps.failureRetryMs);
        log(JSON.stringify({ level: "error", event: "operator_alert_failed", kind: alert.kind, httpClass: `${Math.floor(response.status / 100)}xx` }));
        return "FAILED";
      }
      return "SENT";
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    backOff(alert.dedupeKey, (deps.now ?? (() => new Date()))().getTime(), deps.cooldownMs ?? 10 * 60_000, deps.failureRetryMs);
    try {
      log(JSON.stringify({ level: "error", event: "operator_alert_failed", kind: alert.kind, errorName: err instanceof Error ? err.name.replace(/[^A-Za-z0-9_]/g, "").slice(0, 64) : "unknown" }));
    } catch {
      // logging must not raise
    }
    return "FAILED";
  }
}
