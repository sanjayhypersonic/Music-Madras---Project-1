import { isSafeStudioHref } from "./notificationKinds";

// Phase 6K lifecycle hardening (F20) — links in notification e-mails. A link in an e-mail must be ABSOLUTE (a relative path is meaningless in a mail
// client) and must point at this deployment's Studio. It is built only from a validated origin and a validated Studio path; when the origin is not
// configured or not valid the e-mail carries NO link and says where to find the notification instead, rather than a malformed or misleading one.
//
// The origin is the deployment's own address (AUTH_URL). It must be https, except that plain http is accepted for a loopback host (local development).
// A URL with credentials, a query or a fragment, or a path other than "/", is not an origin and is refused.

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** The validated origin ("https://studio.example.org", no trailing slash), or null when the value is missing or unsafe. */
export function resolveStudioOrigin(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (!url.hostname) return null;
  const loopback = LOOPBACK.has(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
  return url.origin;
}

/** An absolute link to a Studio page, or null when there is no valid origin or the path is not a Studio path. */
export function buildStudioLink(origin: string | null, href: string | null | undefined): string | null {
  if (!origin || !href || !isSafeStudioHref(href)) return null;
  return `${origin}${href}`;
}
