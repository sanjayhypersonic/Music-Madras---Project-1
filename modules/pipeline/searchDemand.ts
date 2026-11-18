// Upload-to-draft pipeline (R-34): SEARCH DEMAND. What people are likely to type, so a draft answers it, from the facts it already has.
//
// v1 is QueryPatternDemandProvider: deterministic query patterns per kind of page ("<song> meaning", "who wrote <song>", "<composer> biography").
// No network, no volumes. The Search Console and Google Ads adapters are STUBS: they report themselves unconfigured and suggest nothing, so the
// interface is fixed now and real demand can be added later without touching the pipeline. A suggestion never becomes a fact: a draft only
// answers a query when its approved credits or claims already do (modules/pipeline/drafts.ts).

export type DemandSubjectKind = "VIDEO" | "WORK" | "COMPOSER" | "PERSON" | "CONDUCTOR" | "CHOIR" | "ENSEMBLE" | "ARTIST" | "VENUE" | "ORGANISATION";

export interface SearchDemandSubject {
  kind: DemandSubjectKind;
  name: string;
  /** For a video: its work title, if different. */
  workTitle?: string | null;
  /** An approved transliteration or alternate title. */
  alternateTitle?: string | null;
}

export interface SearchQuerySuggestion {
  query: string;
  source: "pattern" | "search-console" | "google-ads";
  /** Monthly volume when a real adapter knows it; null for patterns. */
  volume: number | null;
}

export interface SearchDemandProvider {
  readonly name: string;
  isConfigured(): boolean;
  suggest(subject: SearchDemandSubject): Promise<SearchQuerySuggestion[]>;
}

const PATTERNS: Readonly<Record<DemandSubjectKind, readonly string[]>> = {
  VIDEO: ["{name}", "{name} meaning", "who wrote {name}", "{name} composer", "{name} choir", "{name} {alt}"],
  WORK: ["{name}", "{name} meaning", "who wrote {name}", "{name} composer", "{name} {alt}"],
  COMPOSER: ["{name}", "{name} biography", "{name} composer", "{name} works"],
  PERSON: ["{name}", "{name} biography", "{name} music"],
  CONDUCTOR: ["{name}", "{name} conductor", "{name} biography"],
  CHOIR: ["{name}", "{name} concerts", "{name} recordings"],
  ENSEMBLE: ["{name}", "{name} concerts", "{name} recordings"],
  ARTIST: ["{name}", "{name} singer", "{name} biography"],
  VENUE: ["{name}", "{name} concerts", "{name} history"],
  ORGANISATION: ["{name}", "{name} choir", "{name} music"],
};

export class QueryPatternDemandProvider implements SearchDemandProvider {
  readonly name = "query-patterns-v1";
  isConfigured() {
    return true;
  }
  async suggest(subject: SearchDemandSubject): Promise<SearchQuerySuggestion[]> {
    const name = (subject.workTitle && subject.kind === "VIDEO" ? subject.workTitle : subject.name).trim();
    const out = new Map<string, SearchQuerySuggestion>();
    for (const pattern of PATTERNS[subject.kind]) {
      if (pattern.includes("{alt}") && !subject.alternateTitle) continue;
      const query = pattern.replace("{name}", name).replace("{alt}", subject.alternateTitle ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      if (query) out.set(query, { query, source: "pattern", volume: null });
    }
    return [...out.values()];
  }
}

/** STUB (R-34): Google Search Console queries for the site. Not built: needs OAuth for the property and a Search Analytics client. */
export class SearchConsoleDemandProvider implements SearchDemandProvider {
  readonly name = "search-console (stub)";
  isConfigured() {
    return false;
  }
  async suggest(): Promise<SearchQuerySuggestion[]> {
    return [];
  }
}

/** STUB (R-34): Google Ads Keyword Planner volumes. Not built: needs a Google Ads developer token and account. */
export class GoogleAdsDemandProvider implements SearchDemandProvider {
  readonly name = "google-ads-keyword-planner (stub)";
  isConfigured() {
    return false;
  }
  async suggest(): Promise<SearchQuerySuggestion[]> {
    return [];
  }
}

/** Every configured provider's suggestions, de-duplicated (the first provider to suggest a query keeps it). */
export async function suggestQueries(providers: readonly SearchDemandProvider[], subject: SearchDemandSubject): Promise<SearchQuerySuggestion[]> {
  const out = new Map<string, SearchQuerySuggestion>();
  for (const p of providers.filter((x) => x.isConfigured())) for (const s of await p.suggest(subject)) if (!out.has(s.query)) out.set(s.query, s);
  return [...out.values()];
}
