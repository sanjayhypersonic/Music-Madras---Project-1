// R-38: two rules about WHO is a person, shared by every place a Person is created or linked (the credits create planner and executor, the
// rerun path for existing Performances, and the Studio create paths for Composer, Conductor and Artist). Pure; unit-tested.
//
//   1. NOT A PERSON'S NAME: "Traditional", "Anonymous", "Unknown" and "Various" (any letter case, with or without an arrangement suffix such as
//      "(arr.)", "(arr. J. Smith)", ", arr." or a trailing full stop) never get a Person or a person page. A Composer record of that name is
//      still created or found as before; only the Person link is withheld.
//   2. TRANSLATOR LABELS: only a contributor label of exactly "Translator" or "Translated by" (any letter case) is a translator, a person
//      credited with a translation. Any other label starting "Translat…", such as "Translation", carries a translated TITLE ("Bless the Lord,
//      O my soul"), which is not a person and stays in the sidecar.

const NON_PERSON = new Set(["traditional", "anonymous", "unknown", "various"]);

/** The name with an arrangement suffix and trailing punctuation removed, lower-cased ("Traditional (arr. J. Smith)" -> "traditional"). */
function bareName(name: string): string {
  return name
    .normalize("NFC")
    .trim()
    .replace(/\s*[([]\s*arr\b[^)\]]*[)\]]\s*$/i, "")
    .replace(/\s*,?\s*\barr(?:\.|anged)?(?:\s+by)?\b.*$/i, "")
    .replace(/[\s.,;:]+$/, "")
    .toLocaleLowerCase();
}

/** True for "Traditional", "Anonymous", "Unknown" and "Various" (any case, any arrangement suffix): never a Person. */
export function isNonPersonName(name: string): boolean {
  return NON_PERSON.has(bareName(name));
}

/**
 * Whether a contributor label credits a translator (a person): exactly "Translator" or "Translated by", any letter case. The label is the role
 * part of a review row's roleLabel ("UNMODELLED Translator" -> "Translator"), as videoCreditsApproved.roleOf returns it.
 */
export function isTranslatorLabel(label: string): boolean {
  const l = label.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return l === "translator" || l === "translated by";
}

/** Any label starting "Translat…" that is NOT a translator label: a translated title, kept in the sidecar. */
export function isTranslatedTitleLabel(label: string): boolean {
  return /^translat/i.test(label.trim()) && !isTranslatorLabel(label);
}
