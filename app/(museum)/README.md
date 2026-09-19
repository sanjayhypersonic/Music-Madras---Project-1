# app/(museum) — later-phase scope

Reserved for the public Museum route group (ADR §3, §9): `page.tsx` (home), `composers/[slug]`, `works/[slug]`, `artists/[slug]`, `programmes/[slug]`, `performances/[slug]`, `recordings/[slug]`, `venues/[slug]`, `collections/[slug]`, `learning/[slug]`, `articles/[slug]`, plus `sitemap.xml`/`robots.txt` route handlers.

Deliberately empty in Phase 1 — the root `app/page.tsx` is a temporary Phase 1 foundation placeholder, not the real homepage, so it is not placed inside this route group yet (that would mean building the Museum homepage, which the Phase 1 guardrails explicitly exclude).
