// Phase 6J-1 — a minimal liveness probe for an uptime monitor or the host's
// health check. It proves the app is up and answering; it deliberately does NOT
// touch the database (an unauthenticated route must not be a way to load it),
// and it reveals nothing — no version, environment, host or configuration.
// Rendered per request so it can never be a frozen build-time "ok".

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
