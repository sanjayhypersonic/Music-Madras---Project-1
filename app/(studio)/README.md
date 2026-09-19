# app/(studio) — Music Madras Studio

The authenticated content-management application (ADR §3, §7, §8), built in Phase 4 — see [`docs/phase-4-studio.md`](../../docs/phase-4-studio.md) for the full route map, the authentication architecture, and what remains deferred.

No `/studio/register` route exists, or ever will — Studio is invite-only (ADR §7). YouTube sync (`youtube-sync`) has no UI yet; it depends on the Phase 3 sync engine, which has no live credentials in this environment.
