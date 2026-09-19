# Music Madras — Production Platform

This is the production Next.js application for Music Madras, being built per [`docs/architecture/ADR-0001-production-platform.md`](docs/architecture/ADR-0001-production-platform.md).

**Current status:** Phase 1 (application foundation) complete. No public Museum pages, Studio screens, authentication, or YouTube integration exist yet — see [`docs/phase-1-foundation.md`](docs/phase-1-foundation.md) for exactly what Phase 1 does and does not include.

The original Google AI Studio–built prototype has been preserved, unmodified, in [`legacy-prototype/`](legacy-prototype/LEGACY_NOTICE.md) as a product/UX/content reference — it is not part of this application.

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in real values as they become available
npm run prisma:generate
npm run dev
```

See [`docs/phase-1-foundation.md`](docs/phase-1-foundation.md) for the full command reference, environment variable list, and architecture boundaries.
