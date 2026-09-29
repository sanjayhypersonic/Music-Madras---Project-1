import { randomUUID } from "crypto";

// Phase 6G-18 — the deliberate privacy choice this phase makes: no
// analytics cookie is ever set on the visitor's browser, and no
// persistent, cross-request identifier is stored anywhere. There is no
// consent/cookie-banner mechanism anywhere in this codebase yet (checked
// in preflight), and introducing one is explicitly out of this phase's
// scope (brief §5) — so this project does not read or write a GA4-style
// `_ga` client-id cookie, which would need one.
//
// Instead, every server-rendered page view generates one fresh, random,
// throwaway id — scoped to that single request only, discarded
// immediately after, reused across the few events one page load might
// fire (e.g. `page_view` + `entity_view`) so GA4 can at least group those
// together, but never handed to the browser and never reused across a
// navigation. The trade-off this accepts: GA4 cannot stitch a visitor's
// multi-page journey into one "session," and each page load will look
// like a distinct anonymous user. What it still answers correctly —
// exactly what this phase's objective asks for — is "how many times was
// this page/entity/Learning Guide viewed," without identifying anyone.
// Real GA4 session/user analytics would require a real client-side tag
// and a genuine consent decision — a deliberately separate, larger future
// phase, not guessed at here.
export function createEphemeralSessionId(): string {
  return randomUUID();
}
