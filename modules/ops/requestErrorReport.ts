// Unhandled-server-error reporting (launch readiness; project register R-15). PURE: it turns whatever the framework hands the error hook into the few SAFE facts that
// may be logged or stored. The one rule: NOTHING FROM THE REQUEST OR THE ERROR'S MESSAGE LEAVES THIS FUNCTION. Not the URL (it can contain slugs, tokens and search
// text), not headers, not the message or stack (they can name internals, paths, SQL or values). What survives: the class of error, the route PATTERN
// (`/app/recordings/[slug]/page`, never a concrete address), the kind of context, and the framework's own opaque digest (which links the line to the server log entry).

export interface RequestErrorContext {
  routePath?: unknown;
  routeType?: unknown;
  routerKind?: unknown;
}

const ROUTE_TYPES = new Set(["render", "route", "action", "proxy"]);

/** Control-flow signals the framework raises on purpose (notFound(), redirect(), dynamic bailouts) are not failures. */
export function shouldReportRequestError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && /^NEXT_(NOT_FOUND|REDIRECT|HTTP_ERROR_FALLBACK)/.test(digest)) return false;
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && /^(DynamicServerError|BailoutToCSRError|PostponedError)$/.test(name)) return false;
  }
  return true;
}

/** "PrismaClientKnownRequestError" -> "PRISMA_CLIENT_KNOWN_REQUEST_ERROR": a bounded code in the incident alphabet, or UNSPECIFIED. Never the message. */
export function errorReasonCode(error: unknown): string {
  const raw = typeof error === "object" && error !== null && typeof (error as { name?: unknown }).name === "string" ? (error as { name: string }).name : "";
  const code = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return /^[A-Z][A-Z0-9_]*$/.test(code) && code.length <= 64 ? code : "UNSPECIFIED";
}

/** "/app/recordings/[slug]/page" -> "app-recordings-slug-page": an identifier in the incident subject alphabet. Empty when nothing usable. */
export function routeSubjectId(routePath: unknown): string | null {
  if (typeof routePath !== "string") return null;
  const id = routePath
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id) ? id : null;
}

export interface SafeRequestError {
  event: "unhandled_server_error";
  errorName: string;
  reasonCode: string;
  routeType: string;
  /** The route PATTERN as the framework reports it; reduced to the safe alphabet. */
  route: string | null;
  digest: string | null;
}

export function describeRequestError(error: unknown, context: RequestErrorContext): SafeRequestError {
  const digest = typeof error === "object" && error !== null && typeof (error as { digest?: unknown }).digest === "string" ? (error as { digest: string }).digest : null;
  const reasonCode = errorReasonCode(error);
  const routeType = typeof context.routeType === "string" && ROUTE_TYPES.has(context.routeType) ? context.routeType : "unknown";
  const pattern = typeof context.routePath === "string" ? context.routePath.replace(/[^A-Za-z0-9/_\[\]().-]+/g, "?").slice(0, 120) : null;
  return {
    event: "unhandled_server_error",
    errorName: reasonCode === "UNSPECIFIED" ? "unspecified" : (error as { name: string }).name.replace(/[^A-Za-z0-9_]/g, "").slice(0, 64),
    reasonCode,
    routeType,
    route: pattern,
    digest: digest && /^[A-Za-z0-9_-]{1,64}$/.test(digest) ? digest : null,
  };
}

/** A per-instance limiter so an error storm cannot become a write storm on the database (the log line is never limited by this). */
export function createWriteLimiter(maxPerWindow: number, windowMs: number, now: () => number = Date.now) {
  let windowStart = now();
  let count = 0;
  return function allow(): boolean {
    const t = now();
    if (t - windowStart >= windowMs) {
      windowStart = t;
      count = 0;
    }
    if (count >= maxPerWindow) return false;
    count += 1;
    return true;
  };
}
