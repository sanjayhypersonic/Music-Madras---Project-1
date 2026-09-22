// Converts the YouTube Data API's ISO 8601 duration string
// (contentDetails.duration, e.g. "PT4M13S") into whole seconds, matching
// YouTubeVideo.durationSeconds (Int?). The adapter deliberately passes the
// raw string through unconverted (see modules/youtube/adapter/types.ts's
// own comment on durationIso8601) — this is that mapping decision, made
// once, in the sync engine that actually persists it.
//
// Only the subset YouTube ever returns for a video is supported: an
// optional date part (days only — YouTube durations never carry
// years/months) and a time part (hours/minutes/seconds, allowing
// fractional seconds, which are truncated to whole seconds).

const ISO_8601_DURATION_PATTERN = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export function parseIso8601Duration(value: string | null): number | null {
  if (!value) return null;

  const match = ISO_8601_DURATION_PATTERN.exec(value.trim());
  if (!match) return null;

  const [, days, hours, minutes, seconds] = match;
  if (!days && !hours && !minutes && !seconds) return null;

  const totalSeconds =
    (days ? Number(days) * 86400 : 0) +
    (hours ? Number(hours) * 3600 : 0) +
    (minutes ? Number(minutes) * 60 : 0) +
    (seconds ? Math.floor(Number(seconds)) : 0);

  return totalSeconds;
}
