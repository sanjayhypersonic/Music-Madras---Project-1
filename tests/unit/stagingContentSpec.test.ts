import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseStagingContentSpec, verifyEvidence, type FixtureVideoText, type StagingContentSpec } from "../../modules/seed/stagingContentSpec";

// The curated content file and the check that every fact in it is a verbatim quotation of the video it cites.

const root = path.resolve(__dirname, "../..");
const raw = JSON.parse(readFileSync(path.join(root, "content/staging/first-recording.json"), "utf8"));
const fixtures = JSON.parse(readFileSync(path.join(root, "tests/fixtures/realYouTubeVideos.json"), "utf8")) as { videos: FixtureVideoText[] };
const parsed = parseStagingContentSpec(raw);
const spec = (parsed.ok ? parsed.spec : null) as StagingContentSpec;

describe("the shipped content file", () => {
  it("parses, and every fact in it is quoted verbatim from its source video", () => {
    expect(parsed.ok).toBe(true);
    expect(verifyEvidence(spec, fixtures.videos)).toEqual([]);
  });

  it("covers the video 'Dingiri Dingalae' and loads only what its credits state", () => {
    expect(spec.recording.youtubeVideoId).toBe("zEQmnmwr5UE");
    expect(spec.work.title).toBe("Dingiri Dingalae");
    expect(spec.composer.name).toBe("Traditional");
    expect(spec.venue.name).toBe("Asian College of Journalism");
  });

  it("does not invent the venue type: it is null, so the Venue and the Performance are not loaded", () => {
    expect(spec.venue.type).toBeNull();
  });

  it("lists what it leaves out, each with a reason (the credited choir, conductor, ensemble, arranger, the venue type, the date)", () => {
    const facts = spec.omissions.map((o) => o.fact).join(" | ");
    for (const needle of ["Venue type", "Choir", "Conductor", "Ensemble", "Arranger", "Performance date", "Composer"]) expect(facts).toContain(needle);
    for (const o of spec.omissions) expect(o.reason.length).toBeGreaterThan(20);
  });

  it("cites only a PUBLIC video", () => {
    const video = fixtures.videos.find((v) => v.youtubeVideoId === spec.recording.youtubeVideoId);
    expect(video?.privacyStatus).toBe("public");
  });
});

describe("evidence verification", () => {
  it("refuses a quotation that is not in the cited text, and names where", () => {
    const bad = { ...spec, composer: { ...spec.composer, evidence: { ...spec.composer.evidence, quote: "composed by Somebody" } } };
    const problems = verifyEvidence(bad, fixtures.videos);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^composer: the quotation "composed by Somebody" does not occur in the description of zEQmnmwr5UE/);
  });

  it("refuses a fact that cites the wrong field or a video that is not in the fixtures", () => {
    const wrongField = { ...spec, venue: { ...spec.venue, evidence: [{ ...spec.venue.evidence[0], field: "title" as const }] } };
    expect(verifyEvidence(wrongField, fixtures.videos)[0]).toMatch(/^venue\[0\]:.*title of zEQmnmwr5UE/);
    const missing = { ...spec, work: { ...spec.work, evidence: { ...spec.work.evidence, youtubeVideoId: "nope" } } };
    expect(verifyEvidence(missing, fixtures.videos)[0]).toMatch(/cites video nope, which is not in the fixtures/);
  });

  it("ignores zero-width characters and white-space differences, as YouTube descriptions carry them", () => {
    const videos: FixtureVideoText[] = [{ youtubeVideoId: "zEQmnmwr5UE", title: "t", description: "Recorded live at the​ Asian College\n  of Journalism", privacyStatus: "public" }];
    const s = { ...spec, composer: { ...spec.composer, evidence: { youtubeVideoId: "zEQmnmwr5UE", field: "description" as const, quote: "at the Asian College of Journalism" } } };
    expect(verifyEvidence({ ...s, work: { ...s.work, evidence: s.composer.evidence }, programme: { ...s.programme, evidence: s.composer.evidence }, venue: { ...s.venue, evidence: [s.composer.evidence] }, recording: { ...s.recording, titleEvidence: { youtubeVideoId: "zEQmnmwr5UE", field: "title", quote: "t" } } }, videos)).toEqual([]);
  });

  it("refuses when the Recording's own video is absent from the fixtures", () => {
    expect(verifyEvidence({ ...spec, recording: { ...spec.recording, youtubeVideoId: "absent" } }, fixtures.videos).join(" ")).toMatch(/recording: video absent is not in the fixtures/);
  });
});

describe("parsing", () => {
  const clone = () => JSON.parse(JSON.stringify(raw));
  it.each([
    ["a wrong version", (o: Record<string, unknown>) => (o.version = 2)],
    ["a missing composer", (o: Record<string, unknown>) => delete o.composer],
    ["an invalid slug", (o: { work: { slug: string } }) => (o.work.slug = "Not A Slug")],
    ["an unknown venue type", (o: { venue: { type: string } }) => (o.venue.type = "STADIUM")],
    ["evidence without a quote", (o: { work: { evidence: { quote: string } } }) => (o.work.evidence.quote = "")],
    ["no venue evidence", (o: { venue: { evidence: unknown[] } }) => (o.venue.evidence = [])],
    ["malformed omissions", (o: { omissions: unknown }) => (o.omissions = "none")],
  ])("refuses %s", (_label, mutate) => {
    const o = clone();
    (mutate as (x: unknown) => void)(o);
    expect(parseStagingContentSpec(o).ok).toBe(false);
  });

  it("accepts a sourced venue type", () => {
    const o = clone();
    o.venue.type = "CONCERT_HALL";
    const r = parseStagingContentSpec(o);
    expect(r.ok && r.spec.venue.type).toBe("CONCERT_HALL");
  });
});
