# Final YouTube synchronization — launch gate runbook

Status: PREPARED in Phase 6J-5. **Not executed.** The final full synchronization is a V1 launch gate; it is run once,
by a person, only after Phase 6J-5 is accepted. This document is the procedure and the pass/fail criteria.

The script is `scripts/runYouTubeFullSync.ts` (`npm run youtube:full-sync`). It never deletes a row, never touches a
Recording, MediaResource, Collection or video page, and writes only the synchronization mirror
(YouTubeVideo, YouTubePlaylist, YouTubePlaylistItem, field ownership, conflicts, observability transitions,
checkpoints, the SyncJobRun row and one audit entry). It is idempotent: a re-run is always safe.

## 0. Who and where

- One operator runs it from a clean checkout of the launch commit, on a machine with network access to the real database
  and the YouTube Data API. Nobody else runs a sync or a deploy during the window.
- The target is whatever `DATABASE_URL` / `DIRECT_URL` name. There is **no** production-versus-test guard in the script:
  the host and database name it prints are the only confirmation. Read them.

## 1. Preflight (nothing is changed)

1. **Git**: `git status` is clean; `git log -1` is the intended launch commit; unit and integration suites passed on it.
2. **Environment** (names only; never paste values into tickets or chat): `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID`,
   `DATABASE_URL` (pooled), `DIRECT_URL` (direct, **same database**). The script now refuses (exit 4) a missing variable,
   a pooled `DIRECT_URL`, or a `DIRECT_URL` that names a different database/host than `DATABASE_URL`.
   `TEST_DATABASE_URL` must be unset in this shell.
3. **YouTube credentials**: the key is restricted to the YouTube Data API v3; `YOUTUBE_CHANNEL_ID` is the Music Madras
   channel (starts with `UC`). Daily quota needed is ~30–40 units of the 10,000 default.
4. **Backup / snapshot**: create a database restore point **before** `--execute` (Neon: create a branch from the current
   head, or note the exact timestamp for point-in-time restore). Record its name here: `________________`.
5. **Dry run**: `npm run youtube:full-sync`. It calls no YouTube API and writes nothing. Confirm all of:
   - "Application database" and "Run-lock database" are the intended production host/database;
   - "Run lock free: true";
   - exit code 0 (4 = configuration problem: fix and repeat).
6. **Record the baseline** (read-only SQL in the Neon console, or the dry-run output where it applies) and write the numbers
   in the launch log:
   - `YouTubeVideo` rows total and by `observabilityState` (dry run prints the by-state counts);
   - `YouTubePlaylist` rows; `YouTubePlaylistItem` rows by state;
   - `SyncCheckpoint` rows for provider YOUTUBE (expected: `channel-uploads`, `channel-playlists`, one per playlist);
   - the last `SyncJobRun` (id, status, finished-at);
   - `AuditLogEntry` total;
   - `Recording` / `MediaResource` / `YouTubeVideoPage` counts (the sync must not change these).
   Phase 6J-4/6J-5 reference values observed read-only: 226 videos, 12 playlists, 12 checkpoints, 728 audit rows,
   0 recordings, 0 video pages. Re-capture on the day; do not trust these.

## 2. Manual YouTube baseline (from YouTube itself, not from our database)

Record, from YouTube Studio / the channel page, on the same day:
- total videos in YouTube Studio → Content (note how many are Public, Unlisted, Private);
- the channel page's public video count (this is what the API reports as `statistics.videoCount`);
- the number of playlists, and the video count of each public playlist (at least the two Christmas-carol playlists).

An API key sees public videos (uploads) and videos reachable through public playlists. It does **not** see private
videos, and an unlisted video is seen only if it sits in a visible playlist. Expected differences against the Studio
total are therefore private videos and unlisted videos outside playlists — account for each one by name.

## 3. Execute — ONCE

```
npm run youtube:full-sync -- --execute
```

Do not interrupt it (SIGINT marks the run FAILED, exit 5). Expected behaviour: prints `EXECUTING against <host/db>`,
then the run id, Status, Completeness, per-resource counts, conflicts, failed records, absence-flagging status, the
reconciliation line, any `error [phase]` lines and the checkpoint line. Exit codes:

| Code | Meaning | Action |
|---|---|---|
| 0 | SUCCEEDED | go to §4 |
| 1 | PARTIAL | **not** a pass; read every `error [..]` line, fix the cause, re-run (safe) |
| 2 | FAILED | inspect `SyncJobRun.errorDetails`; re-run after fixing |
| 3 | ALREADY_RUNNING | another run holds the lock; wait, do not force |
| 4 | CONFIGURATION | nothing ran; fix the environment |
| 5 | INTERRUPTED | run marked FAILED; re-run |

A PARTIAL run flags nothing as not-observed (absence is only judged when the whole scope was observed).
A run that would flag more than half of a catalogue of 10+ videos, or flags videos while observing none, is
refused by the engine: nothing is flagged, the run is PARTIAL and says so (`error [absenceFlagging]`).

## 4. Success criteria — ALL must hold

The final sync is **not** successful (do not proceed to launch) if any of these is true:

- exit code is not 0; Status is not SUCCEEDED; Completeness is not FULL;
- `Records failed` > 0, or any `error [..]` line is printed;
- "Video absence flagging" is SKIPPED, or `flagged` is non-zero and not fully explained (every flagged video must be one
  you can name: deleted, made private, or an unlisted video outside any playlist) — compare with §2;
- the Reconciliation line is MISMATCH and the difference is not explained by private/unlisted videos you can name
  (a MISMATCH does not change the exit code — you must read it);
- the checkpoint line is a WARNING listing missing scopes, or the checkpoint rows are not `FULL` with a recent
  `lastFullCompletionAt`;
- any open `SyncConflict` you cannot explain (conflicts mean YouTube changed a field Music Madras controls — review each);
- the `Recording` / `MediaResource` / `YouTubeVideoPage` counts differ from the baseline;
- any video is unexpectedly `NOT_OBSERVED`, or a public/unlisted video is missing.

## 5. Post-sync verification

1. **Idempotency**: immediately run `npm run youtube:full-sync -- --execute` a second time. Expect SUCCEEDED/FULL,
   `created 0`, `flagged 0`, no new conflicts. (`updated` may be non-zero for view/like/comment counters that moved.)
2. **Job result**: the SyncJobRun row for each run — status, counts, empty `errorDetails`; the audit entry
   `youtube.sync.reconciliation` for each run.
3. **Checkpoints**: `channel-uploads`, `channel-playlists` and one per observed playlist, all `FULL`.
4. **Conflicts and errors**: `SyncConflict` rows for these run ids (should be none or each explained);
   `ObservabilityTransition` rows (only the expected flaggings/restorations).
5. **Counts**: videos, playlists, memberships versus the §1 baseline and the §2 YouTube numbers; every difference named.
6. **Spot-check 5–10 real videos** in Studio → YouTube Videos: title, description (non-ASCII text such as accents and
   emoji intact), duration, privacy, thumbnail, playlist memberships; include one unlisted video, one with no
   description, and one in two playlists.
7. **Spot-check playlists**: names, item counts, order, privacy.
8. **Public exposure**: with no Recording or video page published, `/sitemap.xml` lists no video; for any published video
   page confirm a public video is shown and an unlisted video is shown only if a human approved it; a private or
   `NOT_OBSERVED` video is never public.
9. Record the outcome (date, operator, run ids, exit codes, counts) in the launch log. Only then proceed to the final
   public smoke test and launch.

## 6. If something goes wrong

- Never edit sync tables by hand to "fix" a result. Re-running is safe and idempotent.
- A video wrongly flagged NOT_OBSERVED recovers on the next pass that observes it (Phase 6J-5).
- If the data is genuinely wrong: restore from the §1 restore point rather than patching rows, then investigate.
</content>
