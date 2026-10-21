import { createHash } from "crypto";
import { distinctMeaningfulNotes, placeholderReason, sameText } from "./textQuality";

// Phase 6K-4 — the quality rubric a playlist page must pass before it can be published, and keeps passing while it is live.
//
// It is deliberately NOT a word count. Each criterion tests something that makes a playlist page worth a visitor's time and that a person can
// act on: the page says what it is, it has enough videos the Museum can actually show, someone has supplied real context about the selection,
// it can be found sensibly, and it is not a duplicate. Which criteria are required, and their thresholds, are settings (playlistQuality.*);
// the criteria themselves are application logic. Every result explains itself, so an editor is told exactly what is missing — never just
// "failed". Pure and deterministic: it judges the facts it is given and nothing else.
//
// Phase 6K lifecycle hardening (F13): "someone wrote something" is not enough, so the text criteria also refuse what is DEMONSTRABLY empty or
// redundant (textQuality.ts): a title, summary, search description or note that is a placeholder or has no letters in it; a summary that only repeats
// the title; a search description that only repeats the title or the summary; context notes that are placeholders or repeat each other (they are not
// counted). That is all it does. It cannot see prose quality and it does NOT establish that anything a page says is true: a person still reads and
// approves, and passing this rubric proves nothing about accuracy.

export interface PlaylistQualityConfig {
  requireSummary: boolean;
  minEligibleVideos: number;
  requireSeoDescription: boolean;
  /** How many pieces of human-supplied context (answers to the interview or editor notes) the page needs; 0 switches the check off. */
  minContextInputs: number;
}

export interface PlaylistQualityFacts {
  title: string;
  summary: string | null;
  seoDescription: string | null;
  /** Curated members the Museum may currently show on this playlist page. */
  eligibleMemberCount: number;
  /** All curated members, including ones that are not currently shown. */
  totalMemberCount: number;
  /**
   * The text of each recorded, human-supplied context input (an answer, or an editor's note), oldest first. NULL when the page was published before
   * its context was recorded: the context check is then not applied (there is nothing true to judge it by) rather than guessed.
   */
  contextTexts: readonly string[] | null;
  /** Another LIVE playlist page (published, not archived) already uses the same title. Drafts elsewhere are irrelevant and never counted. */
  titleTakenByAnotherPage: boolean;
}

export type CriterionKey = "TITLE" | "UNIQUE_TITLE" | "SUMMARY" | "MIN_VIDEOS" | "HUMAN_CONTEXT" | "SEARCH_DESCRIPTION" | "HIDDEN_MEMBERS";

export interface CriterionResult {
  key: CriterionKey;
  label: string;
  /** PASS and FAIL are required checks; ADVISORY is information that never blocks publication. */
  status: "PASS" | "FAIL" | "ADVISORY";
  detail: string;
}

export interface PlaylistQualityResult {
  passed: boolean;
  criteria: CriterionResult[];
  failing: CriterionResult[];
  /** Identifies the SET of failing checks, so the same failure is not announced twice. */
  fingerprint: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function normaliseTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().toLowerCase();
}

const present = (value: string | null | undefined) => (value ?? "").trim().length > 0;

export function evaluatePlaylistQuality(facts: PlaylistQualityFacts, config: PlaylistQualityConfig): PlaylistQualityResult {
  const criteria: CriterionResult[] = [];
  const check = (key: CriterionKey, label: string, ok: boolean, passDetail: string, failDetail: string) =>
    criteria.push({ key, label, status: ok ? "PASS" : "FAIL", detail: ok ? passDetail : failDetail });

  const titleProblem = !present(facts.title) ? "Give the page a title." : (() => {
    const reason = placeholderReason(facts.title);
    return reason ? `The title does not say what the page is (${reason}). Give the page a real title.` : null;
  })();
  check("TITLE", "The page has a title", titleProblem === null, "A title is set.", titleProblem ?? "Give the page a title.");
  check("UNIQUE_TITLE", "The title is not used by another playlist page", !facts.titleTakenByAnotherPage, "The title is distinct.", "Another published playlist page already has this title; choose one that tells them apart.");

  if (config.requireSummary) {
    let problem: string | null = null;
    if (!present(facts.summary)) problem = "Add a short summary saying what this playlist is and why these videos belong together.";
    else if (placeholderReason(facts.summary!)) problem = `The summary does not say anything yet (${placeholderReason(facts.summary!)}). Write a short summary saying what this playlist is and why these videos belong together.`;
    else if (present(facts.title) && sameText(facts.summary!, facts.title)) problem = "The summary only repeats the title. Say what the title does not: what this playlist is and why these videos belong together.";
    check("SUMMARY", "The page says what the playlist is", problem === null, "A summary is written.", problem ?? "Add a summary.");
  }

  check(
    "MIN_VIDEOS",
    `At least ${plural(config.minEligibleVideos, "video", "videos")} the Museum can show`,
    facts.eligibleMemberCount >= config.minEligibleVideos,
    `${plural(facts.eligibleMemberCount, "video", "videos")} can be shown.`,
    `Only ${plural(facts.eligibleMemberCount, "video", "videos")} can be shown; ${config.minEligibleVideos} ${config.minEligibleVideos === 1 ? "is" : "are"} needed. Add videos the Museum lists, or approve unlisted ones for this playlist.`
  );

  if (config.minContextInputs > 0 && facts.contextTexts !== null) {
    const { counted, ignored } = distinctMeaningfulNotes(facts.contextTexts);
    const skipped = ignored.length > 0 ? ` ${plural(ignored.length, "note was", "notes were")} not counted because ${plural(ignored.length, "it is", "they are")} a placeholder or repeat${ignored.length === 1 ? "s" : ""} another.` : "";
    check(
      "HUMAN_CONTEXT",
      `Someone has supplied context about the selection (at least ${config.minContextInputs})`,
      counted.length >= config.minContextInputs,
      `${plural(counted.length, "piece", "pieces")} of context recorded.${skipped}`,
      `${plural(counted.length, "piece", "pieces")} of distinct context recorded; ${config.minContextInputs} needed.${skipped} Answer the interview questions or add your own notes about why these videos were chosen.`
    );
  }

  if (config.requireSeoDescription) {
    let problem: string | null = null;
    if (!present(facts.seoDescription)) problem = "Add a search description so the page is described sensibly in search results.";
    else if (placeholderReason(facts.seoDescription!)) problem = `The search description does not say anything yet (${placeholderReason(facts.seoDescription!)}). Describe the page for search results.`;
    else if (present(facts.title) && sameText(facts.seoDescription!, facts.title)) problem = "The search description only repeats the title. Describe the page in a sentence that adds to the title.";
    else if (present(facts.summary) && sameText(facts.seoDescription!, facts.summary!)) problem = "The search description only repeats the summary. Write it for search results: a sentence that makes someone want to open the page.";
    check("SEARCH_DESCRIPTION", "A search description is written", problem === null, "A search description is set.", problem ?? "Add a search description.");
  }

  const hidden = facts.totalMemberCount - facts.eligibleMemberCount;
  if (hidden > 0) {
    criteria.push({
      key: "HIDDEN_MEMBERS",
      label: "Some chosen videos are not currently shown",
      status: "ADVISORY",
      detail: `${plural(hidden, "chosen video is", "chosen videos are")} not shown to visitors (not listed, not published, unavailable, or an unlisted video without approval for this playlist).`,
    });
  }

  const failing = criteria.filter((c) => c.status === "FAIL");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(failing.map((c) => c.key).sort()))
    .digest("hex")
    .slice(0, 32);
  return { passed: failing.length === 0, criteria, failing, fingerprint };
}
