// R-37: a work's ALTERNATE TITLES (MusicalWork.alternateTitles) as an editor types them in Studio. Pure; unit-tested with fake data.
//
// One title per line. Each line is trimmed and its inner white space collapsed; blank lines are dropped; a title already listed (compared
// case-insensitively, after Unicode NFC normalisation) is dropped, keeping the FIRST spelling typed. Nothing else is changed: an original-script
// title (Tamil, Malayalam, Cyrillic …) and a Latin transliteration are kept exactly as typed, side by side.

export const ALTERNATE_TITLE_MAX_LENGTH = 300;
export const ALTERNATE_TITLES_MAX = 30;

const key = (title: string) => title.normalize("NFC").toLocaleLowerCase();

export function parseAlternateTitles(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const title = line.normalize("NFC").replace(/\s+/g, " ").trim();
    if (!title || seen.has(key(title))) continue;
    seen.add(key(title));
    out.push(title);
  }
  return out;
}

/** Why a parsed list cannot be saved (null when it can). */
export function alternateTitlesProblem(titles: readonly string[]): string | null {
  if (titles.length > ALTERNATE_TITLES_MAX) return `At most ${ALTERNATE_TITLES_MAX} alternate titles.`;
  const long = titles.find((t) => t.length > ALTERNATE_TITLE_MAX_LENGTH);
  return long ? `An alternate title is longer than ${ALTERNATE_TITLE_MAX_LENGTH} characters: "${long.slice(0, 40)}…".` : null;
}

/** The textarea's value for a stored list: one title per line. */
export const formatAlternateTitles = (titles: readonly string[]): string => titles.join("\n");
