# Music Madras — project register

Single, deduplicated list of decisions, open owner decisions, deferred risks and release gates. **Rule:** record, keep severity, revisit at the single release-readiness audit. Entries cite the existing report that holds the evidence; they are **not re-verified here**. Update this file in the same change that resolves or adds an item.

Last updated: 2026-10-21 · Branch `music-madras-production-rebuild` · Phase 6K committed locally (`637d7e9`) · Phase 6L implemented, uncommitted · `main` = `3bcfe85` (untouched)

## 1. Settled decisions

| ID | Decision | Source |
|---|---|---|
| D-01 | Archive at the foundation, discovery at the surface; MMKE is the canonical knowledge layer, Museum the public archive, Studio the authenticated editorial app; YouTube is a source and distribution channel, not the archive | ADR-0001 |
| D-02 | AI proposes only: it never invents facts, approves sources, publishes, or bypasses human review | ADR-0002 §2.8 |
| D-03 | Only a **private** video or an **archived** page permanently revokes exposure approvals. Unavailable / deleted / not-observed stay hidden but keep their approval; unlisted keeps approvals; metadata review does not unpublish | ADR-0002 §11.1 |
| D-04 | Relationship editing stays `CATALOGUE_WRITE`; a live Collection change needs `RECORDING_PUBLISH` | recording-publication-safety §13A–B |
| D-05 | The relationship cutover (Phase 6L) is a **launch gate**, done before the first real Recording | owner, 2026-10-21 |
| D-06 | Detach rule: a published detach is canonical; a draft-only detach stays in that draft | recording-publication-safety §13C |
| D-07 | 6L: no read-time fallback to legacy rows; no editable draft → read-only published links and an explicit "start a draft"; legacy Recording-level writes rejected (rows kept); the three link states are displayed | owner, 2026-10-21 |

## 2. Open owner decisions

| ID | Decision needed | Needed for | Source |
|---|---|---|---|
| O-01 | Neon recovery policy (Free plan, 6-hour history, production is the root branch): a longer window, or written acceptance of snapshot-only recovery | any production migration or cutover | phase-6j-12c §9, 12d §6 |
| O-02 | Approval to apply the pending migrations to production (6J-10F, 6J-11B and the 12 Phase 6K migrations) after a fresh pre-change snapshot, by a person with the direct URL | deployment | phase-6j-12d §6 |
| O-03 | Hosting provider; scheduler for `/api/cron/stewardship`; `CRON_SECRET`, `AUTH_URL`, `PUBLIC_SITE_URL`, production domain and environment | deployment, email delivery | deployment-readiness-gate §6; scheduled-maintenance runbook |
| O-04 | Email provider and a real delivery test | notifications | ADR-0002 §8 |
| O-05 | Whether public brand text moves from code into editorial blocks | post-launch | ADR-0002 §9 |
| O-06 | Whether the cutover's re-projection rollback is ever authorised for production (it cannot carry unpublished draft edits back) | rollback only | relationship-cutover runbook |

## 3. Deferred risks

| ID | Risk | Severity | Revisit | Source |
|---|---|---|---|---|
| R-01 | The older public gate (`isYouTubeVideoPagePublic`) does not consult holds; a hold on a **public** video may not hide it on the recording / search paths (unverified) | Medium | audit | pre-commit review 2026-10-21 |
| R-02 | Occasions on Performance, Programme and Collection; Learning Guide membership; Sheet Music Requests; `MediaResource` rights links are unversioned and live | Low–Medium | audit | recording-publication-safety §10, §15 |
| R-03 | `npm audit`: 10 high (`eslint-config-next` chain; `prisma → @prisma/config → deepmerge-ts`, `mysql2` production-classified); none touched | Medium | audit | Phase 6K hardening report |
| R-04 | Studio pages and the Museum were never exercised in a browser for Phase 6K / 6L; no real SMTP, real model or production verification | Medium | audit | ADR-0002 §11.4 |
| R-05 | Firebase prototype key is public by design; its security rules were not inspected | Medium | before launch | content-intelligence-architecture §119 |
| R-06 | New approvals are refused while a video is not `OBSERVED` (conservative; a re-approval after private → unlisted waits for the sync) | Low | audit | videoExposureRepository |
| R-07 | Notification email is at-least-once (a rare duplicate is possible) | Low | accepted | scheduled-maintenance runbook |
| R-08 | Public videos have no metadata review; only unlisted approvals are tracked | Low | audit | ADR-0002 §11.4 |
| R-09 | Abandoned drafts keep participant clones; a refused promotion has no merge | Low | post-launch | recording-publication-safety, Limitations |
| R-10 | Studio internal lists use plain `contains`; archive category copy and brand text are still in code | Low | post-launch | ADR-0002 §8, §9 |
| R-11 | The public Organisation page omits an inconsistent Recording's links (never unverified, never legacy rows) and logs it on the server (`Organisation page: … omitted … (reason)`); there is no alert or counter yet, so someone must watch the server log. Studio and the AI context stay strict (they throw) | Low | audit | recording-publication-safety §15 |
| R-12 | Legacy Recording-level rows remain in the database as frozen history; removal is a separate approved migration after a soak period | Low | post-soak | relationship-cutover runbook |
| R-13 | The backfill and re-projection tools operate on the whole database; their tests rely on the suite's serial, clean-up-after-yourself discipline | Low | audit | relationship cutover rehearsal |

## 4. Release gates (not met)

Empty Museum (no real Recordings yet); no CI; no error monitoring or alerting; no hosting or scheduler; email delivery unproven; production domain and environment unset; the deployment-readiness gate never rehearsed on a real host; recovery policy undecided (O-01); pending migrations not applied (O-02). Source: `phase-6j-8-production-readiness-audit.md` (2026-10-14, not re-verified), `phase-6j-12d`, `deployment-readiness-gate.md` §6.

## 5. Deferred product scope (post-launch)

Public Occasion pages; field-ownership UI; analytics feedback loop; Search Console; contributor portal; vector search / RAG; AI usage quotas; Studio design-token refactor and broad accessibility pass. Source: `content-intelligence-architecture.md` §119 and §16.

## 6. Escalation rule

Investigate immediately only for credible data loss, security exposure, irreversible production damage or another critical failure. Everything else waits for the single release-readiness audit.
