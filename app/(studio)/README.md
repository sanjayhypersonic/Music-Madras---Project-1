# app/(studio) — later-phase scope

Reserved for the authenticated Studio route group (ADR §3, §7, §8): `studio/accept-invite`, `studio/reset-password`, `studio/dashboard`, `studio/recordings/[id]` (the editorial wizard), `studio/catalogue/[entity]`, `studio/youtube-sync`, `studio/sheet-music-requests`, `studio/users`, `studio/settings`, `studio/audit-log`.

Deliberately empty in Phase 1 per the guardrails ("do NOT implement Studio screens" / "authentication screens"). No `/studio/register` route will ever exist — Studio is invite-only (ADR §7).
