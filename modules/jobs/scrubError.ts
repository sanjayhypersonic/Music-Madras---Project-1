// Phase 6K lifecycle hardening (F7/F10) — a failure description that is SAFE TO STORE AND SHOW: enough for an administrator to tell what went wrong
// (which kind of error, and a short reason), never anything that could leak a secret. Used for the stewardship run records, the email delivery
// `lastError`, and the Studio health view.
//
// The message of a database, network or mail error can contain a connection string with a password, a host and port, an e-mail address, an API key
// or a bearer token. Every such shape is replaced before anything is stored, the message is cut to one short line, and an unrecognised error type
// is reported by a fixed name rather than by whatever its message says. This is defence in depth, not a promise that no message can ever leak: callers
// still never put credentials in a message on purpose.

export interface ScrubbedError {
  /** An error class (and a database error code), restricted to a safe alphabet: "PrismaClientKnownRequestError:P2002", "Error", "TimeoutError". */
  kind: string;
  /** One short line, with URLs, addresses, tokens and credentials replaced. */
  summary: string;
}

const MAX_SUMMARY = 240;

export function scrubMessage(message: string): string {
  return message
    .split(/\r?\n/)[0]
    // URLs and connection strings of any scheme (postgresql://user:pass@host/db, smtp://…, https://…), including everything after the scheme.
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]")
    // "Bearer abc…" first, so an "Authorization: Bearer abc" header loses the token as well as the label.
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    // key=value / key: value pairs that name a secret.
    .replace(/\b(password|passwd|pwd|secret|token|api[_-]?key|apikey|authorization|credential[s]?)\b\s*[:=]\s*(?:Bearer \[redacted\]|\S+)/gi, "$1=[redacted]")
    // E-mail addresses.
    .replace(/[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+/g, "[address]")
    // Long opaque runs (keys, hashes, tokens).
    .replace(/\b[A-Za-z0-9_\-+/=]{28,}\b/g, "[redacted]")
    // Host:port pairs and bare IP addresses.
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "[host]")
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)+:\d{2,5}\b/gi, "[host]")
    .trim()
    .slice(0, MAX_SUMMARY);
}

const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_.]{0,59}$/;
const SAFE_CODE = /^[A-Z0-9_]{1,20}$/;
const SAFE_REASON = /^[A-Z0-9_]{1,25}( [A-Z0-9_]{1,25}){0,2}$/;

export function describeError(err: unknown): ScrubbedError {
  if (err instanceof Error) {
    const name = SAFE_NAME.test(err.name) ? err.name : "Error";
    const code = (err as { code?: unknown }).code;
    const kind = typeof code === "string" && SAFE_CODE.test(code) ? `${name}:${code}` : name;
    // An error may carry a short `reason` made of codes only (an SMTP error code and reply number); it is shown when it has exactly that shape.
    const reason = (err as { reason?: unknown }).reason;
    const reasonText = typeof reason === "string" && SAFE_REASON.test(reason) ? ` (${reason})` : "";
    return { kind, summary: `${scrubMessage(err.message) || "No message."}${reasonText}`.slice(0, MAX_SUMMARY) };
  }
  return { kind: "UnknownError", summary: "A non-error value was thrown." };
}

/** "Kind: summary", for a single text column. */
export function describeErrorLine(err: unknown): string {
  const { kind, summary } = describeError(err);
  return `${kind}: ${summary}`.slice(0, 300);
}
