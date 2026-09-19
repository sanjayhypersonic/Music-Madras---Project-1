# Legacy Prototype — Read This First

This directory contains the original Google AI Studio–built Vite/React prototype, moved here **unmodified** (via `git mv`, full history preserved) on 2026-09-19 as part of Phase 1 of the production rebuild described in [`/docs/architecture/ADR-0001-production-platform.md`](../docs/architecture/ADR-0001-production-platform.md).

## Why it moved

The approved architecture (ADR-0001 §3) places the new Next.js production application at the **repository root**, matching standard Vercel/Next.js conventions. The prototype previously occupied the root (its own `package.json`, `vite.config.ts`, `index.html`, `src/`, etc.), which would have conflicted with the new app's own root-level `package.json`/`next.config`/`app/` directory. Moving the prototype here — rather than deleting or overwriting it — keeps it fully intact and runnable as a reference.

## What this is for

- **Product/UX reference** — the 11-step editorial wizard, entity model concepts, and editorial standards (`src/mmke/*.md`) documented what the Studio *should* do, even though (per the separate audit) none of it persisted data.
- **Content source** — the 35 real recordings, 4 playlists, channel description, and equipment copy in `src/data.ts` are real Music Madras content, scheduled for migration into the new schema per ADR §22 (not yet done as of Phase 1).
- **Rollback reference** — nothing about this prototype has been altered. If anything in the new build needs to be cross-checked against "what did the old one do here," this is the exact original code.

## What this is *not*

This code is **not** part of the production application going forward. It is not built, linted, tested, or deployed as part of the new app's pipeline. It remains runnable standalone (`cd legacy-prototype && npm install && npm run dev`) purely for reference purposes.

## Status

Superseded. No further feature work should happen here. See the ADR for the current architecture and `/docs/` for Phase 1 foundation documentation.
