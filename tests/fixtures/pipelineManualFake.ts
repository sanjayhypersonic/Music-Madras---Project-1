// R-34 manual mode: FAKE review sheets, research answers and prose for the manual entity-first tests. Invented videos, people, places and URLs;
// no real API, no database, no real review data.
import { CREDITS_HEADER, NAMES_HEADER, toCsv } from "../../modules/jobs/videoCreditsReview";
import { ENTITY_RESEARCH_FORMAT_V1, VIDEO_DRAFT_FORMAT_V1 } from "../../modules/ai/prompts/pipelineManual/pipelineManualPromptV1";

const T1 = "Come Now, Fake Child | Fake Chapel Choir";
const T2 = "Fake Gloria | Fake Chapel Choir & Fake String Quartet";
const T3 = "போலிப் பாடல் | Poli Paadal | The Fake Chapel Choir";

type Row = { id: string; title: string; kind: string; name: string; roleLabel: string; workTitle?: string; quote: string; field?: string; decision?: string };
const row = (r: Row) => {
  const v: Record<string, string> = {
    youtubeVideoId: r.id,
    youtubeUrl: `https://www.youtube.com/watch?v=${r.id}`,
    youtubeTitle: r.title,
    proposedRecordingTitle: "",
    originalLanguageTitle: "",
    transliteration: "",
    kind: r.kind,
    name: r.name,
    roleLabel: r.roleLabel,
    workTitle: r.workTitle ?? "",
    sourceField: r.field ?? "description",
    quote: r.quote,
    basis: "2 stated in description",
    venueTypeBasis: "",
    isReference: "false",
    schemaHome: "",
    missingInformationAndQuestion: "",
    tier: "GREEN",
    decision: r.decision ?? "",
    editedName: "",
    notes: "",
  };
  return CREDITS_HEADER.map((h) => v[h] ?? "");
};

export const FAKE_CREDITS_CSV = toCsv(CREDITS_HEADER, [
  row({ id: "fakeVideo01", title: T1, kind: "work", name: "Come Now, Fake Child", roleLabel: "WORK", quote: "Come Now, Fake Child — performed by the Fake Chapel Choir." }),
  row({ id: "fakeVideo01", title: T1, kind: "composer", name: "Ann Example", roleLabel: 'COMPOSER (label "Words and Music")', workTitle: "Come Now, Fake Child", quote: "Words and Music: Ann Example" }),
  row({ id: "fakeVideo01", title: T1, kind: "arranger", name: "Cara Placeholder", roleLabel: 'ARRANGER (label "Arrangement")', workTitle: "Come Now, Fake Child", quote: "Arrangement: Cara Placeholder" }),
  row({ id: "fakeVideo01", title: T1, kind: "choir/ensemble", name: "Fake Chapel Choir", roleLabel: 'CHOIR (label "Choir")', quote: "Choir: Fake Chapel Choir" }),
  row({ id: "fakeVideo01", title: T1, kind: "conductor", name: "Ben Sample", roleLabel: 'CONDUCTOR (label "Conductor")', quote: "Conductor: Ben Sample" }),
  row({ id: "fakeVideo01", title: T1, kind: "venue", name: "Fake Chapel", roleLabel: 'VENUE (label "Venue")', quote: "Venue: Fake Chapel" }),
  row({ id: "fakeVideo01", title: T1, kind: "performer", name: "Dee Soloist", roleLabel: 'PERFORMER (label "Soprano")', quote: "Soprano: Dee Soloist" }),
  row({ id: "fakeVideo02", title: T2, kind: "work", name: "Fake Gloria", roleLabel: "WORK", quote: "Fake Gloria", field: "title" }),
  row({ id: "fakeVideo02", title: T2, kind: "composer", name: "Ann Example", roleLabel: 'COMPOSER (label "Composer")', workTitle: "Fake Gloria", quote: "Composer: Ann Example" }),
  row({ id: "fakeVideo02", title: T2, kind: "choir/ensemble", name: "Fake Chapel Choir", roleLabel: 'CHOIR (label "Choir")', quote: "Choir: Fake Chapel Choir" }),
  row({ id: "fakeVideo02", title: T2, kind: "choir/ensemble", name: "Fake String Quartet", roleLabel: 'ENSEMBLE (label "Strings")', quote: "Strings: Fake String Quartet" }),
  row({ id: "fakeVideo02", title: T2, kind: "venue", name: "Fake Chapel", roleLabel: 'VENUE (label "Venue")', quote: "Venue: Fake Chapel" }),
  row({ id: "fakeVideo02", title: T2, kind: "performer", name: "Not A Person", roleLabel: 'PERFORMER (label "Thanks")', quote: "Thanks: Not A Person" }),
  row({ id: "fakeVideo03", title: T3, kind: "work", name: "போலிப் பாடல்", roleLabel: "WORK", quote: "போலிப் பாடல்", field: "title" }),
  row({ id: "fakeVideo03", title: T3, kind: "composer", name: "Eli Invented", roleLabel: 'COMPOSER (label "Music")', workTitle: "போலிப் பாடல்", quote: "Music: Eli Invented" }),
  row({ id: "fakeVideo03", title: T3, kind: "choir/ensemble", name: "The Fake Chapel Choir", roleLabel: "CHOIR", quote: "The Fake Chapel Choir", field: "title" }),
  row({ id: "fakeVideo03", title: T3, kind: "institution", name: "Fake College", roleLabel: 'UNMODELLED INSTITUTION (label "Presented by")', quote: "Presented by Fake College" }),
  row({ id: "fakeVideo03", title: T3, kind: "venue", name: "Fake Chapel", roleLabel: 'VENUE (label "Venue")', quote: "Venue: Fake Chapel", decision: "reject" }),
]);

export const FAKE_NAMES_CSV = toCsv(NAMES_HEADER, [
  ["work", "Come Now, Fake Child", 1, "Come Now, Fake Child", "fakeVideo01", "accept", ""],
  ["work", "Fake Gloria", 1, "Fake Gloria", "fakeVideo02", "accept", ""],
  ["work", "போலிப் பாடல்", 1, "போலிப் பாடல்", "fakeVideo03", "accept", ""],
  ["composer", "Ann Example", 2, "Ann Example", "fakeVideo01 fakeVideo02", "accept", ""],
  ["composer", "Eli Invented", 1, "Eli Invented", "fakeVideo03", "accept", ""],
  ["arranger", "Cara Placeholder", 1, "Cara Placeholder", "fakeVideo01", "accept", ""],
  ["conductor", "Ben Sample", 1, "Ben Sample", "fakeVideo01", "accept", ""],
  ["choir/ensemble", "Fake Chapel Choir", 2, "Fake Chapel Choir", "fakeVideo01 fakeVideo02", "merge", "Fake Chapel Choir"],
  ["choir/ensemble", "The Fake Chapel Choir", 1, "The Fake Chapel Choir", "fakeVideo03", "merge", "Fake Chapel Choir"],
  ["choir/ensemble", "Fake String Quartet", 1, "Fake String Quartet", "fakeVideo02", "accept", ""],
  ["venue", "Fake Chapel", 2, "Fake Chapel", "fakeVideo01 fakeVideo02", "accept", ""],
  ["institution", "Fake College", 1, "Fake College", "fakeVideo03", "accept", ""],
  ["performer", "Dee Soloist", 1, "Dee Soloist", "fakeVideo01", "", ""],
  ["performer", "Not A Person", 1, "Not A Person", "fakeVideo02", "reject", ""],
]);

/** An entity-research answer as the owner's Claude account might return it for the composer "Ann Example". */
export const ANN_RESEARCH = {
  format: ENTITY_RESEARCH_FORMAT_V1,
  entityKey: "COMPOSER:ann example",
  entityName: "Ann Example",
  claims: [
    { subjectKind: "publisher", workTitle: null, value: "Example Press", statement: "Ann Example's carols are published by Example Press.", sourceUrl: "https://examplepress.test/composers/ann-example", sourceTitle: "Example Press: Ann Example", sourceKind: "publisher", tier: "A", excerpt: "Ann Example (b. 1950), composer. Carols published by Example Press.", retrievedOn: "2026-11-19" },
    { subjectKind: "background", workTitle: null, value: "Fakeshire", statement: "Ann Example was born in Fakeshire.", sourceUrl: "https://en.wikipedia.org/wiki/Ann_Example", sourceTitle: "Ann Example - Wikipedia", sourceKind: "hymnal index or reference work", tier: "B", excerpt: "Ann Example (born 1950 in Fakeshire) is a composer.", retrievedOn: "2026-11-19" },
    { subjectKind: "background", workTitle: null, value: "Fakeville", statement: "Ann Example lives in Fakeville.", sourceUrl: "https://genius.com/ann-example", sourceTitle: "Genius", sourceKind: "other", tier: "C", excerpt: "Ann Example lives in Fakeville.", retrievedOn: "2026-11-19" },
    { subjectKind: "publisher", workTitle: null, value: "Invented Press", statement: "Ann Example is published by Invented Press.", sourceUrl: "https://examplepress.test/other", sourceTitle: null, sourceKind: "publisher", tier: "A", excerpt: "Ann Example's catalogue lists several carols.", retrievedOn: "2026-11-19" },
    { subjectKind: "publisher", workTitle: null, value: "Example Press", statement: "Ann Example's carols are published by Example Press.", sourceUrl: "https://examplepress.test/composers/ann-example", sourceTitle: "Example Press: Ann Example", sourceKind: "publisher", tier: "A", excerpt: "Ann Example (b. 1950), composer. Carols published by Example Press.", retrievedOn: "2026-11-19" },
    { subjectKind: "background", workTitle: null, value: "Fakeshire", statement: "Ann Example grew up in Fakeshire.", sourceUrl: "https://fakeshire-news.test/ann", sourceTitle: "Fakeshire News", sourceKind: "national newspaper", tier: "B", excerpt: "", retrievedOn: "2026-11-19" },
  ],
  conflicts: [],
  notFound: ["no date of first publication"],
};

/** Research for the work "Come Now, Fake Child" that disagrees with the video's credit (Ann Example) and with itself. */
export const WORK_RESEARCH = {
  format: ENTITY_RESEARCH_FORMAT_V1,
  entityKey: "WORK:come now, fake child",
  entityName: "Come Now, Fake Child",
  claims: [
    { subjectKind: "composer", workTitle: "Come Now, Fake Child", value: "Hal Other", statement: "A national newspaper names Hal Other as the composer of Come Now, Fake Child.", sourceUrl: "https://national-daily.example.test/arts", sourceTitle: "National Daily (fake)", sourceKind: "national newspaper", tier: "B", excerpt: "the carol Come Now, Fake Child by Hal Other", retrievedOn: "2026-11-19" },
    { subjectKind: "publisher", workTitle: "Come Now, Fake Child", value: "Example Press", statement: "Come Now, Fake Child was published by Example Press.", sourceUrl: "https://examplepress.test/catalogue/come-now-fake-child", sourceTitle: "Example Press catalogue", sourceKind: "publisher", tier: "A", excerpt: "Come Now, Fake Child (SATB). Words and music: Ann Example. Example Press, 1998.", retrievedOn: "2026-11-19" },
    { subjectKind: "publisher", workTitle: "Come Now, Fake Child", value: "Other Press", statement: "Come Now, Fake Child was published by Other Press.", sourceUrl: "https://otherpress.test/c", sourceTitle: "Other Press", sourceKind: "publisher", tier: "A", excerpt: "Come Now, Fake Child, Other Press edition", retrievedOn: "2026-11-19" },
  ],
  conflicts: [],
  notFound: [],
};

/** Summary prose for fakeVideo01 (credits C1 work, C2 composer, C3 lyricist, C4 arranger, C5 choir, C6 conductor, C7 venue, C8 date). */
export const PROSE_ANSWER = {
  summary: [
    { sentence: "Come Now, Fake Child is a work by Ann Example, performed by the Fake Chapel Choir at Fake Chapel on 12 December 2025.", support: ["C1", "C2", "C5", "C7", "C8"] },
    { sentence: "The arrangement is by Cara Placeholder and the conductor is Ben Sample.", support: ["C4", "C6"] },
  ],
  seoTitle: null,
  metaDescription: null,
};

export const VIDEO_DRAFT_ANSWER = { format: VIDEO_DRAFT_FORMAT_V1, youtubeVideoId: "fakeVideo01", ...PROSE_ANSWER };
