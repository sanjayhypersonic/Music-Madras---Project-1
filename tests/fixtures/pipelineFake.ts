// R-34: FAKE data for the upload-to-draft pipeline tests and walkthrough. Invented video, people, places and URLs; no real API or database.
import { FakeAIProvider } from "../../modules/ai/providers/fake/fakeAIProvider";
import type { AIGenerationRequest, AIResearchRequest } from "../../modules/ai/provider/aiProvider";
import type { PipelinePorts, PipelineVideoRow, QueueCandidate, StagePatch } from "../../modules/pipeline/run";
import type { AliasDecision, CatalogueIndex } from "../../modules/pipeline/resolve";
import type { ProposedPipelineClaim } from "../../modules/pipeline/research";
import type { DraftClaim } from "../../modules/pipeline/drafts";
import type { StoredEntityClaim } from "../../modules/pipeline/entityClaims";

export const FAKE_TITLE = "Come Now, Fake Child | Fake Chapel Choir";
export const FAKE_DESCRIPTION = [
  "Come Now, Fake Child — performed by the Fake Chapel Choir.",
  "Words and Music: Ann Example",
  "Arrangement: Cara Placeholder",
  "Choir: Fake Chapel Choir",
  "Conductor: Ben Sample",
  "Venue: Fake Chapel",
  "Date: 12 December 2025",
  "#Advent #FakeChoir",
].join("\n");

export const extractionOutput = {
  recordingKind: { value: "PERFORMANCE", quote: "Come Now, Fake Child — performed by the Fake Chapel Choir.", field: "description" },
  credits: [
    { role: "WORK", name: "Come Now, Fake Child", workTitle: null, quote: "Come Now, Fake Child — performed by the Fake Chapel Choir.", field: "description" },
    { role: "COMPOSER", name: "Ann Example", workTitle: "Come Now, Fake Child", quote: "Words and Music: Ann Example", field: "description" },
    { role: "LYRICIST", name: "Ann Example", workTitle: "Come Now, Fake Child", quote: "Words and Music: Ann Example", field: "description" },
    { role: "ARRANGER", name: "Cara Placeholder", workTitle: "Come Now, Fake Child", quote: "Arrangement: Cara Placeholder", field: "description" },
    { role: "CHOIR", name: "Fake Chapel Choir", workTitle: null, quote: "Choir: Fake Chapel Choir", field: "description" },
    { role: "CONDUCTOR", name: "Ben Sample", workTitle: null, quote: "Conductor: Ben Sample", field: "description" },
    { role: "VENUE", name: "Fake Chapel", workTitle: null, quote: "Venue: Fake Chapel", field: "description" },
  ],
  performanceDate: { value: "2025-12-12", quote: "Date: 12 December 2025", field: "description" },
  venueType: { value: "CHURCH", quote: "Venue: Fake Chapel", field: "description", fromName: true },
  suggestedTitle: { value: "Come Now, Fake Child", quote: "Come Now, Fake Child", field: "title", alternateTitle: { value: null, quote: null, field: null } },
  gaps: [],
};

/** Web research answers per subject name: passages with citations (URL, title, the page's own cited text). */
export const RESEARCH: Record<string, Array<{ text: string; citations: Array<{ url: string; title: string | null; citedText: string }> }>> = {
  "Come Now, Fake Child": [
    { text: "Example Press published the carol in 1998.", citations: [{ url: "https://examplepress.test/catalogue/come-now-fake-child", title: "Example Press catalogue", citedText: "Come Now, Fake Child (SATB). Words and music: Ann Example. Example Press, 1998." }] },
    { text: "A fan blog says it was first sung in Fakeville.", citations: [{ url: "https://fakefan.blogspot.com/come-now", title: "Fake fan blog", citedText: "It was first sung at a harvest service in Fakeville, the blog says." }] },
  ],
  "Cara Placeholder": [{ text: "Cara Placeholder is an arranger.", citations: [{ url: "https://hymnary.org/person/Placeholder_Cara", title: "Cara Placeholder | Hymnary.org", citedText: "Cara Placeholder, arranger, b. 1960" }] }],
  "Fake Chapel": [{ text: "A newspaper names Hal Other as the composer.", citations: [{ url: "https://national-daily.example.test/arts", title: "National Daily (fake)", citedText: "the carol by Hal Other was sung at Fake Chapel" }] }],
};

/** The claims call's answer per subject (it may only cite the citations it was given). */
export const CLAIMS: Record<string, unknown> = {
  "Come Now, Fake Child": {
    claims: [
      { citation: "P1.C1", subjectKind: "publisher", workTitle: "Come Now, Fake Child", value: "Example Press", statement: "Come Now, Fake Child was published by Example Press in 1998.", sourceKind: "publisher" },
      { citation: "P2.C1", subjectKind: "background", workTitle: "Come Now, Fake Child", value: "Fakeville", statement: "Come Now, Fake Child was first sung at a harvest service in Fakeville.", sourceKind: "blog, fan site or social media" },
      { citation: "P9.C9", subjectKind: "publisher", workTitle: null, value: "Invented Press", statement: "It was published by Invented Press.", sourceKind: "publisher" },
    ],
    notFound: [],
  },
  "Cara Placeholder": { claims: [{ citation: "P1.C1", subjectKind: "arranger", workTitle: null, value: "Cara Placeholder", statement: "Cara Placeholder is an arranger born in 1960.", sourceKind: "hymnal index or reference work" }], notFound: [] },
  "Fake Chapel": { claims: [{ citation: "P1.C1", subjectKind: "composer", workTitle: "Come Now, Fake Child", value: "Hal Other", statement: "A national newspaper names Hal Other as the composer of the carol sung at Fake Chapel.", sourceKind: "national newspaper" }], notFound: [] },
};

export function fakeProvider(calls: string[] = []) {
  return new FakeAIProvider({
    respond: (request: AIGenerationRequest) => {
      calls.push(`generate:${request.promptVersion}`);
      if (request.promptVersion === "video-credits-v2") return extractionOutput;
      const subject = (request.contextPayload as { subject: { name: string } }).subject.name;
      return CLAIMS[subject] ?? { claims: [], notFound: ["nothing"] };
    },
    researchRespond: (request: AIResearchRequest) => {
      calls.push(`research:${(request.contextPayload as { subject: { name: string } }).subject.name}`);
      return { passages: RESEARCH[(request.contextPayload as { subject: { name: string } }).subject.name] ?? [], usage: { inputTokens: 2000, outputTokens: 300, webSearchRequests: 2 } };
    },
  });
}

/** An in-memory database for the orchestrator. */
export class FakePorts implements PipelinePorts {
  rows = new Map<string, PipelineVideoRow & { fingerprint: string; flags: string[]; draft: unknown; research: unknown; cost: number }>();
  claims = new Map<string, ProposedPipelineClaim[]>();
  writes: string[] = [];
  videos: QueueCandidate[];
  catalogue: CatalogueIndex;
  aliases: AliasDecision[];
  approvedResearch = new Set<string>();
  entityClaims: StoredEntityClaim[] = [];

  constructor(opts: { videos?: QueueCandidate[]; catalogue?: CatalogueIndex; aliases?: AliasDecision[] } = {}) {
    this.videos = opts.videos ?? [{ youtubeVideoRowId: "row-1", youtubeVideoId: "fakeVideo01", title: FAKE_TITLE, description: FAKE_DESCRIPTION, tags: ["advent"], existing: null }];
    this.catalogue = opts.catalogue ?? {};
    this.aliases = opts.aliases ?? [];
  }
  async listQueueCandidates(limit: number) {
    return this.videos
      .map((v) => {
        const row = [...this.rows.values()].find((r) => r.id === `pv-${v.youtubeVideoRowId}`);
        return { ...v, existing: row ? { id: row.id, status: row.status, sourceFingerprint: row.fingerprint } : null };
      })
      .slice(0, limit);
  }
  async enqueue(c: QueueCandidate, fingerprint: string, requeue: boolean) {
    this.writes.push(`enqueue:${c.youtubeVideoId}${requeue ? ":requeue" : ""}`);
    this.rows.set(`pv-${c.youtubeVideoRowId}`, { id: `pv-${c.youtubeVideoRowId}`, youtubeVideoId: c.youtubeVideoId, title: c.title, description: c.description, publishedAt: "2025-12-20T10:00:00.000Z", privacyStatus: "public", observabilityState: "OBSERVED", status: "QUEUED", attempts: 0, extraction: null, resolution: null, fingerprint, flags: [], draft: null, research: null, cost: 0 });
  }
  async listWork(limit: number, maxAttempts: number) {
    return [...this.rows.values()].filter((r) => ["QUEUED", "EXTRACTED", "RESOLVED", "RESEARCHED"].includes(r.status) && r.attempts < maxAttempts).slice(0, limit).map((r) => ({ ...r }));
  }
  async saveStage(id: string, patch: StagePatch) {
    this.writes.push(`save:${id}:${patch.status ?? "-"}`);
    const r = this.rows.get(id)!;
    Object.assign(r, {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.extraction !== undefined ? { extraction: patch.extraction } : {}),
      ...(patch.resolution !== undefined ? { resolution: patch.resolution } : {}),
      ...(patch.research !== undefined ? { research: patch.research } : {}),
      ...(patch.draft !== undefined ? { draft: patch.draft } : {}),
      ...(patch.flags ? { flags: patch.flags } : {}),
      ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
    });
    r.cost += patch.addCostUsd ?? 0;
  }
  async replaceClaims(id: string, claims: ProposedPipelineClaim[]) {
    this.claims.set(id, claims);
  }
  async loadClaims(id: string): Promise<DraftClaim[]> {
    return (this.claims.get(id) ?? []).map((c, i) => ({ id: `R${i + 1}`, dbId: `claim-${i + 1}`, subjectKey: c.subjectKey, subjectKind: c.subjectKind, value: c.value, statement: c.statement, excerpt: c.excerpt, sourceUrl: c.sourceUrl, sourceTitle: c.sourceTitle, sourceTier: c.sourceTier, videoRelation: c.videoRelation, status: c.status }));
  }
  async loadEntityClaims(keys: readonly string[]) {
    return this.entityClaims.filter((c) => keys.includes(c.entityKey));
  }
  async loadCatalogueIndex() {
    return this.catalogue;
  }
  async loadAliases() {
    return this.aliases;
  }
  async hasApprovedResearch(kind: string, name: string) {
    return this.approvedResearch.has(`${kind}:${name}`);
  }
  async listPublishedCopySummaries() {
    return [];
  }
}
