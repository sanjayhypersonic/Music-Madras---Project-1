import { describe, expect, it } from "vitest";
import fixture from "../fixtures/guardrailsFakeClaims.json";
import { assessEvidence, independentSources, registrableDomain, tierForStrength, type EvidenceSource } from "../../modules/mmke/guardrails/sources";
import { assessClaims, claimProblems, detectConflicts, markStaleClaims, type GuardedClaim } from "../../modules/mmke/guardrails/claims";
import { checkDraftProse, checkOpeningSentence, checkTraceability, findBannedPhrases, findNearDuplicates, splitSentences, type CitableClaim } from "../../modules/mmke/guardrails/generation";
import { planPublicationBatches } from "../../modules/mmke/guardrails/publication";
import { auditDecisionChanges } from "../../modules/mmke/guardrails/audit";

// The content guardrails (docs/content-guardrails.md), on FAKE data only (tests/fixtures/guardrailsFakeClaims.json: seven claims, 4 and 6 weak).

const NOW = new Date("2026-11-18T12:00:00.000Z");
const claims = fixture.claims as GuardedClaim[];
const ARCHIVE = "This performance is part of the Music Madras archive.";
const src = (url: string, tier: EvidenceSource["tier"], excerpt = url): EvidenceSource => ({ url, tier, excerpt, approved: true });

/** The fixture's claims as a draft may cite them: [1] … [7] = claim 1 … 7, weak where gates 1 and 2 say so. */
const assessed = assessClaims(claims, { now: NOW });
const citable: CitableClaim[] = assessed.map((a, i) => ({ id: String(i + 1), text: [a.claim.statement, a.claim.value ?? "", ...a.claim.sources.map((s) => s.excerpt)].join("\n"), weak: a.weak }));
const check = (prose: string) => checkDraftProse(prose, { title: fixture.video.title, claims: citable, boilerplate: [ARCHIVE], allowed: ["Music Madras"] });

describe("gate 1: source tiers and minimum evidence per claim type", () => {
  it("maps research strengths to tiers, Wikipedia (pointer only) to X", () => {
    expect([tierForStrength("catalogue/publisher"), tierForStrength("reference work"), tierForStrength("news"), tierForStrength("fan site"), tierForStrength("unverified"), tierForStrength("reference work", true)]).toEqual(["A", "B", "B", "C", "X", "X"]);
  });

  it("applies each claim type's minimum: credits need one A or two independent B, background two independent with one A", () => {
    expect(assessEvidence("composer", [src("https://pub.test/a", "A")]).sufficient).toBe(true);
    expect(assessEvidence("composer", [src("https://one.test/a", "B")])).toMatchObject({ sufficient: false, weak: true });
    expect(assessEvidence("composer", [src("https://one.test/a", "B", "music by Ann"), src("https://two.test/b", "B", "Ann wrote the tune in")]).sufficient).toBe(true);
    expect(assessEvidence("background", [src("https://pub.test/a", "A", "x y z"), src("https://news.test/b", "B", "p q r")]).sufficient).toBe(true);
    expect(assessEvidence("background", [src("https://fan.blogspot.com/a", "C")])).toMatchObject({ sufficient: false, weak: true });
    expect(assessEvidence("work-title", [src("https://x.test/a", "X")])).toMatchObject({ sufficient: false, weak: false, reason: "no approved, countable source" });
    expect(assessEvidence("lyrics", [src("https://pub.test/a", "A")]).claimType).toBe("excluded");
  });

  it("counts a site once, and a copied excerpt once (independence)", () => {
    expect(registrableDomain("https://news.bbc.co.uk/x")).toBe("bbc.co.uk");
    expect(independentSources([src("https://a.example.test/1", "B", "first text here now"), src("https://b.example.test/2", "B", "other words entirely different")])).toHaveLength(1);
    const copied = "the carol was written in 1952 by Ann Example for the choir";
    expect(independentSources([src("https://one.test/a", "B", copied), src("https://two.test/b", "B", copied)])).toHaveLength(1);
    expect(assessEvidence("composer", [src("https://one.test/a", "B", copied), src("https://two.test/b", "B", copied)]).sufficient).toBe(false);
  });
});

describe("gate 2: claims", () => {
  it("flags claims 4 and 6 of the fixture as WEAK and the other five as sufficient", () => {
    expect(assessed.every((a) => a.usable)).toBe(true);
    expect(assessed.filter((a) => a.weak).map((a) => a.claim.claimId)).toEqual(["G-claim-4", "G-claim-6"]);
  });

  it("enforces the schema and scope: one sentence, value stated and in an excerpt, no banned wording, a named approver", () => {
    const c = claims[0];
    expect(claimProblems(c)).toEqual([]);
    expect(claimProblems({ ...c, statement: "It is a timeless song. Everyone knows it." }).join(" | ")).toMatch(/more than one sentence.*timeless.*does not contain its value/);
    expect(claimProblems({ ...c, approver: null })).toContain("accepted without a named approver and date");
    expect(claimProblems({ ...c, subjectKind: "lyrics" })[0]).toMatch(/excluded subject/);
  });

  it("reports conflicts and never resolves them: both sides are blocked until an editor rejects one", () => {
    const rival: GuardedClaim = { ...claims[2], claimId: "G-rival", value: "Hal Other", statement: "A review names Hal Other as the arranger.", sources: [src("https://review.test/x", "B", "arranged by Hal Other")] };
    expect(detectConflicts([claims[2], rival])).toEqual([expect.objectContaining({ subjectKind: "arranger", values: ["Gus Arranger", "Hal Other"] })]);
    const blocked = assessClaims([claims[2], rival], { now: NOW });
    expect(blocked.map((a) => a.usable)).toEqual([false, false]);
    expect(blocked[0].reasons.join(" ")).toMatch(/unresolved conflict on arranger/);
    expect(assessClaims([claims[2], { ...rival, status: "rejected" }], { now: NOW })[0].usable).toBe(true);
  });

  it("marks a claim stale when its source changed or it is too old", () => {
    const [changed, old] = markStaleClaims([claims[0], { ...claims[1], retrievedAt: "2024-01-01T00:00:00.000Z" }], { now: NOW, changedUrls: [claims[0].sources[0].url] });
    expect(changed).toMatchObject({ status: "stale", staleReason: expect.stringMatching(/source changed/) });
    expect(old).toMatchObject({ status: "stale", staleReason: expect.stringMatching(/older than 365 days/) });
  });
});

describe("gate 3: generation checks", () => {
  const good = [
    "A Fake Folk Song — performed by the Fake Chorale [5].",
    "The choral arrangement published by Example Press is by Gus Arranger [3][7].",
    "The song was first written down in 1952, according to a national daily [4].",
    "The song was first sung at a harvest festival in Fakeville, according to a fan blog [6].",
    ARCHIVE,
  ].join(" ");

  it("accepts a draft whose every sentence traces to its cited claims, with weak claims attributed", () => {
    expect(check(good)).toEqual({ ok: true, problems: [] });
  });

  it("REJECTS a draft that states claim 6 (weak) as plain fact, cited or not", () => {
    const plain = good.replace("The song was first sung at a harvest festival in Fakeville, according to a fan blog [6].", "The song was first sung at a harvest festival in Fakeville [6].");
    const result = check(plain);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([{ sentence: "The song was first sung at a harvest festival in Fakeville [6].", problem: expect.stringMatching(/states a WEAK claim \(6\) as plain fact/) }]);
    const uncited = good.replace("The song was first sung at a harvest festival in Fakeville, according to a fan blog [6].", "The song was first sung at a harvest festival in Fakeville.");
    expect(check(uncited).problems.map((p) => p.problem)).toEqual([expect.stringMatching(/cites no claim/)]);
  });

  it("checks names, dates, numbers and denials against the cited claims", () => {
    const problems = (sentence: string) => checkTraceability(sentence, citable, { allowed: [fixture.video.title] }).map((p) => p.problem);
    expect(problems("The song was first written down in 1953, according to a national daily [4].")).toEqual([expect.stringMatching(/"1953" is not in the cited claims/)]);
    expect(problems("The choral arrangement is by Hal Unknown [3].")).toEqual([expect.stringMatching(/"Hal" is not/), expect.stringMatching(/"Unknown" is not/)]);
    expect(problems("The arrangement was not published by Example Press [7].")).toEqual([expect.stringMatching(/denial/)]);
    expect(problems("It is a lovely piece [1].")).toEqual([expect.stringMatching(/generic/)]);
    expect(problems("The publisher lists A Fake Folk Song [9].")).toEqual([expect.stringMatching(/\[9\], which is not a usable claim/)]);
  });

  it("finds banned phrases and checks the opening sentence", () => {
    expect(findBannedPhrases("A timeless, breathtaking masterpiece; it is believed to be old.")).toEqual(["timeless", "breathtaking", "masterpiece", "it is believed"]);
    expect(checkOpeningSentence("In this video the Fake Chorale sings [5].", fixture.video)).toEqual([expect.stringMatching(/does not start with the title/), 'generic opener "in this video"']);
    expect(checkOpeningSentence(good, fixture.video)).toEqual([]);
    expect(splitSentences("St. Mary's Church hosts it [1]. Symphony No. 5 follows [2].")).toEqual(["St. Mary's Church hosts it [1].", "Symphony No. 5 follows [2]."]);
  });

  it("flags near-copies across videos and a shared opening once titles are removed", () => {
    const a = { id: "vidAAAAAAAA", title: "First Fake Carol", prose: "First Fake Carol — performed by the Fake Chorale at Fake Hall on 12 December 2025 [1]. The words are by Ann Example [2]." };
    const b = { id: "vidBBBBBBBB", title: "Second Fake Carol", prose: "Second Fake Carol — performed by the Fake Chorale at Fake Hall on 12 December 2025 [1]. The words are by Ann Example [2]." };
    const c = { id: "vidCCCCCCCC", title: "Third Fake Carol", prose: "Third Fake Carol — sung by the Other Choir in 2019 [1]. Its music is by Bo Writer [2]." };
    expect(findNearDuplicates([a, b, c])).toEqual([{ a: "vidAAAAAAAA", b: "vidBBBBBBBB", similarity: 1, sameOpening: true }]);
  });
});

describe("gate 4: publication is planned for people, never automatic", () => {
  it("excludes unchecked, unapproved and conflicted drafts, and samples every weak-claim draft for a second review", () => {
    const plan = planPublicationBatches(
      [
        { id: "v1", checksPassed: true, approvedBy: "Editor One", usesWeakClaims: false, hasUnresolvedConflict: false },
        { id: "v2", checksPassed: true, approvedBy: "Editor One", usesWeakClaims: true, hasUnresolvedConflict: false },
        { id: "v3", checksPassed: false, approvedBy: "Editor One", usesWeakClaims: false, hasUnresolvedConflict: false },
        { id: "v4", checksPassed: true, approvedBy: null, usesWeakClaims: false, hasUnresolvedConflict: false },
        { id: "v5", checksPassed: true, approvedBy: "Editor One", usesWeakClaims: false, hasUnresolvedConflict: true },
      ],
      { batchSize: 10, sampleRate: 0.2, seed: "fake" }
    );
    expect(plan.autoPublish).toBe(false);
    expect(plan.excluded.map((e) => e.id)).toEqual(["v3", "v4", "v5"]);
    expect(plan.batches).toEqual([{ ids: ["v1", "v2"], secondReview: ["v2"] }]);
  });
});

describe("gate 5: audit", () => {
  it("logs first decisions, changed decisions, approver changes and staleness, and nothing that did not change", () => {
    const first = auditDecisionChanges([], [{ claimId: "G-claim-1", decision: "accept", approver: "Editor One" }, { claimId: "G-claim-2", decision: "", approver: "" }], NOW);
    expect(first.map((e) => e.action)).toEqual(["CLAIM_DECIDED"]);
    const later = auditDecisionChanges(first, [{ claimId: "G-claim-1", decision: "reject", approver: "Editor Two", status: "stale" }], NOW);
    expect(later.map((e) => [e.action, e.previousDecision ?? ""])).toEqual([["CLAIM_MARKED_STALE", ""], ["CLAIM_DECISION_CHANGED", "accept"]]);
    expect(auditDecisionChanges(first, [{ claimId: "G-claim-1", decision: "accept", approver: "Editor One" }], NOW)).toEqual([]);
  });
});
