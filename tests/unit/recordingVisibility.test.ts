import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { isVideoExposed, type VideoExposureFacts } from "../../modules/mmke/catalogue/videoExposure";
import {
  BUCKET_LABEL,
  FINDING_KIND_LABEL,
  VISIBILITY_VIEWS,
  classifyRecordingVisibility,
  countVisibility,
  fixLink,
  inView,
  parseVisibilityView,
  type PublishedRevisionFacts,
  type RecordingVisibility,
  type RecordingVisibilityFacts,
} from "../../modules/mmke/recordingVisibility/recordingVisibility";

// The Recording public-visibility classification: bucket (exactly one), the four kinds of finding kept apart, and the rule that a gap is never a blocker.
// Visibility is decided by the EXISTING predicates (isRecordingPublished, isVideoExposed, the publish gate) — these tests pin how their answers are reported.

const publicVideo: VideoExposureFacts = { page: { status: "PUBLISHED", archivedAt: null, unlistedPublicationApprovedAt: null }, youtubeVideo: { privacyStatus: "public", observabilityState: "OBSERVED" }, activeApprovals: [], hold: null };

const fullRevision = (over: Partial<PublishedRevisionFacts> = {}): PublishedRevisionFacts => ({
  id: "rev-pub",
  recordingId: "rec-1",
  revisionStatus: "PUBLISHED",
  title: "Published title",
  works: [{ archived: false }],
  performance: { archived: false, programmeArchived: false, venueArchived: false },
  media: [{ provider: "YOUTUBE", youtubeVideoId: "vid-1" }],
  ...over,
});

const publicRecording = (over: Partial<RecordingVisibilityFacts> = {}, rev: Partial<PublishedRevisionFacts> = {}, video: VideoExposureFacts = publicVideo): RecordingVisibilityFacts => ({
  id: "rec-1",
  slug: "rec-one",
  status: "PUBLISHED",
  currentPublishedRevisionId: "rev-pub",
  currentDraftRevisionId: null,
  published: fullRevision(rev),
  draft: null,
  videos: new Map([["vid-1", video]]),
  ...over,
});

const unpublished = (over: Partial<RecordingVisibilityFacts> = {}): RecordingVisibilityFacts => ({
  id: "rec-2",
  slug: "rec-two",
  status: "DRAFT",
  currentPublishedRevisionId: null,
  currentDraftRevisionId: "rev-draft",
  published: null,
  draft: { id: "rev-draft", title: "Working title", workCount: 1, hasPerformance: true, hasPrimaryVideo: true },
  videos: new Map(),
  ...over,
});

const codes = (r: RecordingVisibility) => r.findings.map((f) => f.code);
const kinds = (r: RecordingVisibility) => r.findings.map((f) => f.kind);

describe("a public recording", () => {
  it("is PUBLIC with nothing to report when it has a work, a performance and venue, and a publicly shown video; its public link is the slug's page", () => {
    const r = classifyRecordingVisibility(publicRecording());
    expect(r).toMatchObject({ bucket: "PUBLIC", findings: [], publicPath: "/recordings/rec-one", hasGaps: false, hasRestrictions: false });
  });

  it("shows the PUBLISHED revision's title, never the open draft's", () => {
    const r = classifyRecordingVisibility(publicRecording({ currentDraftRevisionId: "rev-draft", draft: { id: "rev-draft", title: "Secret draft title", workCount: 9, hasPerformance: true, hasPrimaryVideo: true } }));
    expect(r.title).toBe("Published title");
    expect(JSON.stringify(r)).not.toContain("Secret draft title");
  });

  it("a draft that has a work, venue and video does not hide the PUBLISHED revision's gaps (only published facts are read)", () => {
    const r = classifyRecordingVisibility(
      publicRecording({ draft: { id: "d", title: "t", workCount: 3, hasPerformance: true, hasPrimaryVideo: true }, currentDraftRevisionId: "d" }, { works: [], performance: null, media: [] })
    );
    expect(codes(r)).toEqual(expect.arrayContaining(["NO_WORK", "NO_PERFORMANCE", "NO_VIDEO"]));
  });
});

describe("discovery gaps are never blockers", () => {
  it("no work: a gap, with the existing Works step as the fix", () => {
    const r = classifyRecordingVisibility(publicRecording({}, { works: [] }));
    expect(r.findings).toEqual([expect.objectContaining({ kind: "DISCOVERY_GAP", code: "NO_WORK", fix: { label: expect.any(String), href: "/studio/recordings/rec-1/works" } })]);
    expect(r).toMatchObject({ bucket: "PUBLIC", hasGaps: true, hasRestrictions: false });
  });

  it("works that are all archived are a different gap from no work; partly archived is not a gap", () => {
    expect(codes(classifyRecordingVisibility(publicRecording({}, { works: [{ archived: true }, { archived: true }] })))).toEqual(["WORKS_NOT_PUBLIC"]);
    expect(classifyRecordingVisibility(publicRecording({}, { works: [{ archived: true }, { archived: false }] })).findings).toEqual([]);
  });

  it("no performance: the message says there is no venue either (a venue is attached through a performance), and it links to the Performance step", () => {
    const r = classifyRecordingVisibility(publicRecording({}, { performance: null }));
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ kind: "DISCOVERY_GAP", code: "NO_PERFORMANCE", fix: { href: "/studio/recordings/rec-1/performance" } });
    expect(r.findings[0].message).toMatch(/no venue/);
  });

  it("an archived performance, venue or programme each name themselves and omit the whole performance block", () => {
    const perf = (p: Partial<NonNullable<PublishedRevisionFacts["performance"]>>) => classifyRecordingVisibility(publicRecording({}, { performance: { archived: false, programmeArchived: false, venueArchived: false, ...p } }));
    expect(perf({ archived: true }).findings[0].message).toMatch(/linked performance is archived/);
    expect(perf({ venueArchived: true }).findings[0].message).toMatch(/linked venue is archived/);
    expect(perf({ programmeArchived: true }).findings[0].message).toMatch(/linked programme is archived/);
    expect(codes(perf({ venueArchived: true }))).toEqual(["PERFORMANCE_NOT_PUBLIC"]);
  });

  it("no YouTube video: a gap, and other media types are mentioned but do not count as a video", () => {
    expect(codes(classifyRecordingVisibility(publicRecording({}, { media: [] })))).toEqual(["NO_VIDEO"]);
    const other = classifyRecordingVisibility(publicRecording({}, { media: [{ provider: "OTHER", youtubeVideoId: null }] }));
    expect(codes(other)).toEqual(["NO_VIDEO"]);
    expect(other.findings[0].message).toMatch(/1 other media item is attached/);
  });

  it("a public recording never has a BLOCKER, whatever is missing", () => {
    const r = classifyRecordingVisibility(publicRecording({}, { works: [], performance: null, media: [] }));
    expect(kinds(r)).not.toContain("BLOCKER");
    expect(r.bucket).toBe("PUBLIC");
  });
});

describe("explicit restrictions are reported as restrictions, from the existing video rule", () => {
  const holdOn = (hold: "RIGHTS" | "COPYRIGHT" | "PRIVACY" | "OTHER"): VideoExposureFacts => ({ ...publicVideo, hold });

  it("a hold on a linked video is a RESTRICTION naming the hold, with the video's own Studio page as the fix, and the Recording stays PUBLIC", () => {
    const r = classifyRecordingVisibility(publicRecording({}, {}, holdOn("RIGHTS")));
    expect(r).toMatchObject({ bucket: "PUBLIC", hasRestrictions: true, hasGaps: false });
    expect(r.findings).toEqual([expect.objectContaining({ kind: "RESTRICTION", code: "VIDEO_HOLD", fix: { label: expect.any(String), href: "/studio/catalogue/videos/vid-1" } })]);
    expect(r.findings[0].message).toMatch(/explicit rights hold/);
    // a hold is NOT also reported as a missing video: the restriction explains it
    expect(codes(r)).not.toContain("NO_VIDEO");
  });

  it("every hold kind is named; OTHER is just 'a hold'", () => {
    expect(classifyRecordingVisibility(publicRecording({}, {}, holdOn("COPYRIGHT"))).findings[0].message).toMatch(/explicit copyright hold/);
    expect(classifyRecordingVisibility(publicRecording({}, {}, holdOn("PRIVACY"))).findings[0].message).toMatch(/explicit privacy hold/);
    expect(classifyRecordingVisibility(publicRecording({}, {}, holdOn("OTHER"))).findings[0].message).toMatch(/explicit hold,/);
  });

  it("a private video and an unlisted-without-approval video are restrictions (the visibility rule), distinct from a hold", () => {
    const privateVideo = { ...publicVideo, youtubeVideo: { privacyStatus: "private", observabilityState: "OBSERVED" as const } };
    const unlistedVideo = { ...publicVideo, youtubeVideo: { privacyStatus: "unlisted", observabilityState: "OBSERVED" as const } };
    expect(codes(classifyRecordingVisibility(publicRecording({}, {}, privateVideo)))).toEqual(["VIDEO_PRIVATE"]);
    expect(codes(classifyRecordingVisibility(publicRecording({}, {}, unlistedVideo)))).toEqual(["VIDEO_UNLISTED_NOT_APPROVED"]);
  });

  it("an unlisted video WITH the recorded approvals is shown: no finding", () => {
    const approved: VideoExposureFacts = {
      page: { status: "PUBLISHED", archivedAt: null, unlistedPublicationApprovedAt: new Date() },
      youtubeVideo: { privacyStatus: "unlisted", observabilityState: "OBSERVED" },
      activeApprovals: [{ scope: "PAGE", playlistPageId: null }, { scope: "DISCOVERY", playlistPageId: null }],
      hold: null,
    };
    expect(isVideoExposed(approved, { kind: "DISCOVERY" })).toBe(true);
    expect(classifyRecordingVisibility(publicRecording({}, {}, approved)).findings).toEqual([]);
  });

  it("a video whose page is missing, unpublished, archived or whose video is unavailable is a GAP (not a restriction), explained in the shared wording", () => {
    const noPage: VideoExposureFacts = { ...publicVideo, page: null };
    const draftPage: VideoExposureFacts = { ...publicVideo, page: { status: "DRAFT", archivedAt: null, unlistedPublicationApprovedAt: null } };
    const archivedPage: VideoExposureFacts = { ...publicVideo, page: { status: "PUBLISHED", archivedAt: new Date(), unlistedPublicationApprovedAt: null } };
    const gone: VideoExposureFacts = { ...publicVideo, youtubeVideo: { privacyStatus: "public", observabilityState: "NOT_OBSERVED" } };
    expect(codes(classifyRecordingVisibility(publicRecording({}, {}, noPage)))).toEqual(["VIDEO_PAGE_MISSING"]);
    expect(codes(classifyRecordingVisibility(publicRecording({}, {}, draftPage)))).toEqual(["VIDEO_PAGE_NOT_PUBLISHED"]);
    expect(codes(classifyRecordingVisibility(publicRecording({}, {}, archivedPage)))).toEqual(["VIDEO_PAGE_NOT_PUBLISHED"]);
    expect(codes(classifyRecordingVisibility(publicRecording({}, {}, gone)))).toEqual(["VIDEO_UNAVAILABLE"]);
    expect(classifyRecordingVisibility(publicRecording({}, {}, noPage)).findings[0].message).toContain("No Music Madras page exists yet.");
  });

  it("when one linked video IS shown, another that is merely unpublished is not a gap, but a hold on it is still reported", () => {
    const facts = publicRecording(
      {},
      { media: [{ provider: "YOUTUBE", youtubeVideoId: "vid-1" }, { provider: "YOUTUBE", youtubeVideoId: "vid-2" }, { provider: "YOUTUBE", youtubeVideoId: "vid-3" }] }
    );
    const videos = new Map<string, VideoExposureFacts>([
      ["vid-1", publicVideo],
      ["vid-2", { ...publicVideo, page: null }],
      ["vid-3", { ...publicVideo, hold: "PRIVACY" }],
    ]);
    const r = classifyRecordingVisibility({ ...facts, videos });
    expect(codes(r)).toEqual(["VIDEO_HOLD"]);
  });

  it("a duplicated video id counts once", () => {
    const r = classifyRecordingVisibility(publicRecording({}, { media: [{ provider: "YOUTUBE", youtubeVideoId: "vid-1" }, { provider: "YOUTUBE", youtubeVideoId: "vid-1" }] }, holdOn("RIGHTS")));
    expect(r.findings).toHaveLength(1);
  });

  it("the finding agrees with the shared rule: exposed means no video finding, not exposed means exactly one", () => {
    const cases: VideoExposureFacts[] = [
      publicVideo,
      { ...publicVideo, hold: "OTHER" },
      { ...publicVideo, page: null },
      { ...publicVideo, youtubeVideo: { privacyStatus: "private", observabilityState: "OBSERVED" } },
      { ...publicVideo, youtubeVideo: { privacyStatus: "unlisted", observabilityState: "OBSERVED" } },
      { ...publicVideo, youtubeVideo: { privacyStatus: "public", observabilityState: "NOT_OBSERVED" } },
    ];
    for (const video of cases) {
      const findings = classifyRecordingVisibility(publicRecording({}, {}, video)).findings;
      expect(findings.length, JSON.stringify(video)).toBe(isVideoExposed(video, { kind: "DISCOVERY" }) ? 0 : 1);
    }
  });
});

describe("not determined", () => {
  it("a pointer to a revision of another recording, to a non-PUBLISHED revision, or to nothing readable is NOT_DETERMINED with no public link", () => {
    const foreign = classifyRecordingVisibility(publicRecording({}, { recordingId: "someone-else" }));
    const notPublished = classifyRecordingVisibility(publicRecording({}, { revisionStatus: "DRAFT" }));
    const unreadable = classifyRecordingVisibility(publicRecording({ published: null }));
    for (const r of [foreign, notPublished, unreadable]) {
      expect(r).toMatchObject({ bucket: "NOT_DETERMINED", publicPath: null, hasGaps: false, hasRestrictions: false });
      expect(codes(r)).toEqual(["REVISION_POINTER_INCONSISTENT"]);
      expect(kinds(r)).toEqual(["NOT_DETERMINED"]);
    }
    expect(foreign.findings[0].message).toMatch(/different recording/);
    expect(notPublished.findings[0].message).toMatch(/marked DRAFT, not PUBLISHED/);
  });

  it("missing video facts, or a privacy status the rules do not know, is NOT_DETERMINED (reported, never guessed)", () => {
    expect(codes(classifyRecordingVisibility(publicRecording({ videos: new Map() })))).toEqual(["VIDEO_FACTS_MISSING"]);
    const odd = classifyRecordingVisibility(publicRecording({}, {}, { ...publicVideo, youtubeVideo: { privacyStatus: null, observabilityState: "OBSERVED" } }));
    expect(odd.bucket).toBe("NOT_DETERMINED");
    expect(codes(odd)).toEqual(["VIDEO_UNEXPLAINED"]);
  });

  it("malformed data never throws: it is NOT_DETERMINED", () => {
    const broken = publicRecording();
    (broken.published as unknown as { works: unknown }).works = undefined;
    expect(classifyRecordingVisibility(broken)).toMatchObject({ bucket: "NOT_DETERMINED", publicPath: null });
  });

  it("an archived recording with an odd pointer is still simply not public (the answer is determined)", () => {
    const r = classifyRecordingVisibility(publicRecording({ status: "ARCHIVED", published: null }));
    expect(r.bucket).toBe("PUBLISHED_NOT_DISCOVERABLE");
    expect(codes(r)).toEqual(["ARCHIVED"]);
  });
});

describe("recordings that are not public, and why", () => {
  it("marked PUBLISHED without a published revision is a blocker: the existing predicate needs both", () => {
    const r = classifyRecordingVisibility(publicRecording({ currentPublishedRevisionId: null, published: null }));
    expect(r).toMatchObject({ bucket: "PUBLISHED_NOT_DISCOVERABLE", publicPath: null });
    expect(codes(r)).toEqual(["NO_PUBLISHED_REVISION"]);
    expect(kinds(r)).toEqual(["BLOCKER"]);
  });

  it("unpublished after being published: a status blocker; the earlier revision does not make it public", () => {
    const r = classifyRecordingVisibility(publicRecording({ status: "DRAFT", currentDraftRevisionId: "d", draft: { id: "d", title: "t", workCount: 1, hasPerformance: false, hasPrimaryVideo: true } }));
    expect(r.bucket).toBe("PUBLISHED_NOT_DISCOVERABLE");
    expect(codes(r)).toEqual(["UNPUBLISHED"]);
    expect(r.publicPath).toBeNull();
  });

  it("unpublished with no open draft says a new draft must be started", () => {
    const r = classifyRecordingVisibility(publicRecording({ status: "DRAFT", currentDraftRevisionId: null, draft: null }));
    expect(codes(r)).toEqual(["UNPUBLISHED", "NO_OPEN_DRAFT"]);
    expect(r.findings[1].message).toMatch(/Start a new draft/);
  });

  it("archived is a blocker whether or not it was ever published; never published stays in 'not published yet'", () => {
    expect(classifyRecordingVisibility(unpublished({ status: "ARCHIVED" })).bucket).toBe("NOT_PUBLISHED_YET");
    expect(codes(classifyRecordingVisibility(unpublished({ status: "ARCHIVED" })))).toEqual(["ARCHIVED"]);
    expect(classifyRecordingVisibility(publicRecording({ status: "ARCHIVED" })).bucket).toBe("PUBLISHED_NOT_DISCOVERABLE");
  });

  it("an unpublished recording's blockers are the publish gate's REQUIRED categories (title, a work, a primary video) and nothing else", () => {
    const ready = classifyRecordingVisibility(unpublished());
    expect(codes(ready)).toEqual(["NOT_PUBLISHED_YET"]);
    const bare = classifyRecordingVisibility(unpublished({ draft: { id: "d", title: " ", workCount: 0, hasPerformance: false, hasPrimaryVideo: false } }));
    expect(codes(bare)).toEqual(["NOT_PUBLISHED_YET", "PUBLISH_GATE_TITLE", "PUBLISH_GATE_WORKS", "PUBLISH_GATE_VIDEO"]);
    expect(bare.findings.slice(1).map((f) => f.fix?.href)).toEqual(["/studio/recordings/rec-2/source", "/studio/recordings/rec-2/works", "/studio/recordings/rec-2/media"]);
    expect(bare.findings[2].message).toMatch(/required by the publish gate, not by the public page/);
  });

  it("a missing performance or venue is NOT a blocker for an unpublished recording (the gate only recommends them)", () => {
    const r = classifyRecordingVisibility(unpublished({ draft: { id: "d", title: "t", workCount: 1, hasPerformance: false, hasPrimaryVideo: true } }));
    expect(codes(r)).toEqual(["NOT_PUBLISHED_YET"]);
  });

  it("no open draft and never published: one blocker for the status and one for the missing draft", () => {
    expect(codes(classifyRecordingVisibility(unpublished({ draft: null, currentDraftRevisionId: null })))).toEqual(["NOT_PUBLISHED_YET", "NO_OPEN_DRAFT"]);
  });

  it("a not-public recording is never reported as public, with a gap or a restriction", () => {
    for (const r of [classifyRecordingVisibility(unpublished()), classifyRecordingVisibility(publicRecording({ status: "ARCHIVED" }))]) {
      expect(r).toMatchObject({ publicPath: null, hasGaps: false, hasRestrictions: false });
    }
  });
});

describe("views and counts", () => {
  const results = [
    classifyRecordingVisibility(publicRecording()),
    classifyRecordingVisibility(publicRecording({}, { works: [] })),
    classifyRecordingVisibility(publicRecording({}, { works: [] }, { ...publicVideo, hold: "RIGHTS" })), // gap AND restriction
    classifyRecordingVisibility(publicRecording({ status: "ARCHIVED" })),
    classifyRecordingVisibility(unpublished()),
    classifyRecordingVisibility(publicRecording({ published: null })),
  ];

  it("the four buckets add up to the total; gaps and restrictions are overlapping subsets of public, and counted once each", () => {
    const counts = countVisibility(results);
    expect(counts).toEqual({ counted: 6, public: 3, notDiscoverable: 1, unpublished: 1, undetermined: 1, withGaps: 2, withRestrictions: 1 });
    expect(counts.public + counts.notDiscoverable + counts.unpublished + counts.undetermined).toBe(counts.counted);
    expect(counts.withGaps).toBeLessThanOrEqual(counts.public);
  });

  it("each view picks exactly its recordings; the recording with both a gap and a restriction is in both overlay views and in 'public' once", () => {
    const count = (view: (typeof VISIBILITY_VIEWS)[number]) => results.filter((r) => inView(view, r)).length;
    expect(VISIBILITY_VIEWS.map(count)).toEqual([3, 1, 2, 1, 1, 1]);
  });

  it("an unknown or missing view falls back to 'public'; every bucket and kind has a label", () => {
    expect(parseVisibilityView("nonsense")).toBe("public");
    expect(parseVisibilityView(undefined)).toBe("public");
    for (const view of VISIBILITY_VIEWS) expect(parseVisibilityView(view)).toBe(view);
    expect(Object.keys(BUCKET_LABEL).sort()).toEqual(["NOT_DETERMINED", "NOT_PUBLISHED_YET", "PUBLIC", "PUBLISHED_NOT_DISCOVERABLE"]);
    expect(Object.keys(FINDING_KIND_LABEL).sort()).toEqual(["BLOCKER", "DISCOVERY_GAP", "NOT_DETERMINED", "RESTRICTION"]);
  });

  it("fix links only point at existing Studio routes", () => {
    expect(fixLink("r", "WORKS").href).toBe("/studio/recordings/r/works");
    expect(fixLink("r", "VIDEO", "v").href).toBe("/studio/catalogue/videos/v");
    expect(fixLink("r", "VIDEO").href).toBe("/studio/recordings/r/media");
  });
});

describe("source-level guarantees", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
  const code = (relative: string) => read(relative).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("the classifier, the loader and the view are read-only: no write call, no form, no action", () => {
    for (const file of ["modules/mmke/recordingVisibility/recordingVisibility.ts", "modules/db/repositories/recordingVisibilityRepository.ts"]) {
      expect(code(file), file).not.toMatch(/\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(|\$executeRaw|\$queryRaw|writeAuditLog|\$transaction|withRecordingEditLock/);
    }
    expect(code("components/studio/RecordingVisibility.tsx")).not.toMatch(/<form|<button|action=|"use server"|formAction/);
    expect(code("app/(studio)/studio/(protected)/recordings/visibility/page.tsx")).not.toMatch(/"use server"|<form|<button|formAction/);
  });

  it("the classifier is Prisma-free and reuses the existing rules instead of redefining them", () => {
    const pure = code("modules/mmke/recordingVisibility/recordingVisibility.ts");
    expect(pure).not.toMatch(/@prisma\/client|modules\/db|\.\.\/\.\.\/db/);
    for (const reused of ["isRecordingPublished", "isVideoExposed", "explainVideoExposure", "checkRecordingRevisionCompleteness", "listMissingRequiredCategories"]) expect(pure).toContain(reused);
  });

  it("the loader reads through the published-revision pointer only and never reads Sources, Rights, Occasions or the frozen legacy rows", () => {
    const loader = code("modules/db/repositories/recordingVisibilityRepository.ts");
    expect(loader).toContain("currentPublishedRevision");
    expect(loader).not.toMatch(/entitySource|entityRights|entityOccasion|recordingRevisionSource|recordingRevisionRights|recordingRevisionOccasion|ForEntity\(/);
    expect(loader).not.toMatch(/revisionStatus:\s*["']PUBLISHED["']|where:\s*\{[^}]*revisionStatus/); // never "the published revision" by status
  });

  it("the page checks the signed-in session on the server before it loads anything, and shows a generic message on failure", () => {
    const page = read("app/(studio)/studio/(protected)/recordings/visibility/page.tsx");
    expect(page.indexOf("if (!session) redirect(")).toBeGreaterThan(-1);
    expect(page.indexOf("if (!session) redirect(")).toBeLessThan(page.indexOf("loadRecordingVisibilityWorkspace("));
    expect(page).toMatch(/could not be loaded just now/);
    expect(page).toMatch(/err instanceof Error \? err\.name : "unknown error"/);
  });

  it("the Recordings list links to the workspace", () => {
    expect(read("app/(studio)/studio/(protected)/recordings/page.tsx")).toContain("/studio/recordings/visibility");
  });
});
