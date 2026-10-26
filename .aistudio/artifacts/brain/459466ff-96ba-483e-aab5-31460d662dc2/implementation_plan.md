# Implementation Plan: Latest Upload Feed Sorting & Choir Name Normalization

Align the homepage latest release spotlight with the channel's actual newest upload sorted strictly by publish date, and replace specific choir mentions with generic terms (`Vocal Ensemble` and `Wedding Choir`).

## User Clarifications & Decisions
- **Latest Release Sorting**: Strictly sort by the latest upload date from the feed / archive so that the homepage spotlight features the actual newest release rather than the all-time most-viewed video (`Dingiri Dingalae`).
- **Choir Name Sanitization**: Remove all occurrences of:
  - `"St. Andrew's Kirk Choir"`
  - `"Music Madras Choir"`
  - `"Music Madras Vocal Ensemble"`
  Replace them with generic labels like `Wedding Choir` (for wedding hymns/repertoire) or `Vocal Ensemble` (for general choral/vocal performances).
- **Scope Constraint**: "Do not make any other changes."

---

## Proposed Changes

### 1. Repertoire Data & Types (`src/data.ts`, `src/mmke/types/entities.ts`)
- Replace:
  - `src/data.ts` line 68: `artist: "Music Madras Vocal Ensemble"` -> `artist: "Wedding Choir"` (Psalm 128 / Christian Wedding Song).
  - `src/data.ts` line 194: `artist: "St. Andrew's Kirk Choir"` -> `artist: "Wedding Choir"` (The Lord Bless You and Keep You / Christian Wedding Song).
  - `src/mmke/types/entities.ts` line 167: Remove `"Music Madras Choir"` from comments/examples, replacing with `"Vocal Ensemble"`.
  - Scrub any remaining references across descriptions or metadata.

### 2. Strict Upload Date Sorting for Latest Release (`src/lib/youtube.ts`, `src/App.tsx`)
- In `src/lib/youtube.ts`:
  - When fetching live YouTube videos, prioritize the uploads playlist (`UPLOADS_PLAYLIST_ID`) so newest uploads are fetched first, or sort `mappedVideos` by publish timestamp (`publishedAtRaw` / `publishedAtIso` descending).
  - Add helper function `getLatestUpload(videos: Video[]): Video | undefined` that reliably parses publish date / raw timestamp to return the true newest upload.
- In `src/App.tsx`:
  - Compute `latestRelease = getLatestUpload(videos) || videos[0]`.
  - Feature `latestRelease` inside the Homepage Spotlight Recital card.
  - In the "Featured Concert highlights" section, exclude `latestRelease.id` to prevent duplicate display of the spotlight video in the lower grid.

---

## Verification Plan

### Automated Verification
1. Run `lint_applet` (`tsc --noEmit`) to verify strict TypeScript type checking.
2. Run `compile_applet` (`vite build`) to verify zero bundling or syntax errors.
3. Run `grep` to verify zero occurrences of `"St. Andrew's Kirk Choir"`, `"Music Madras Choir"`, and `"Music Madras Vocal Ensemble"` across `src/`.

### Manual / Browser Verification
1. Verify the Homepage Spotlight displays the true newest upload by date (e.g. `எந்தன் ஜெபவேளை | Enthan Jebavelai` or newest live feed upload) rather than `Dingiri Dingalae`.
2. Verify that clicking "Watch Recording" loads and plays the correct latest video.
3. Verify that cards referencing former choir names now cleanly read `Wedding Choir` or `Vocal Ensemble`.
