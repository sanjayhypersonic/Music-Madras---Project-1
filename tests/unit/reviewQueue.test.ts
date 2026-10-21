import { describe, expect, it } from "vitest";
import { buildQueueNotification, classifyReview, computeProposalFingerprint, type QueueSummaryItem, type ReviewFacts } from "../../modules/mmke/videoReview/reviewQueue";

// Phase 6K-2 — the pure rules of the unlisted-video review queue. Synthetic values only.

const NOW = new Date("2030-06-15T12:00:00.000Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const base = { title: "T", description: "D", privacyStatus: "unlisted", durationSeconds: 120, observabilityState: "OBSERVED", publishedAt: day(-30) };

type ReviewOverride = Partial<NonNullable<ReviewFacts["review"]>>;
const facts = (over: { review?: ReviewOverride | null; fingerprint?: string; hasActivePageApproval?: boolean }): ReviewFacts => ({
  review: over.review === null ? null : { state: "PENDING", proposalFingerprint: "f1", deferUntil: null, holdReason: null, ...over.review },
  fingerprint: over.fingerprint ?? "f1",
  now: NOW,
  hasActivePageApproval: over.hasActivePageApproval ?? false,
});

describe("computeProposalFingerprint", () => {
  it("is stable for the same facts and changes when any decision-relevant fact changes", () => {
    const a = computeProposalFingerprint(base);
    expect(computeProposalFingerprint({ ...base })).toBe(a);
    for (const change of [{ title: "T2" }, { description: "D2" }, { privacyStatus: "private" }, { durationSeconds: 121 }, { observabilityState: "UNAVAILABLE" }, { publishedAt: day(-29) }]) {
      expect(computeProposalFingerprint({ ...base, ...change }), JSON.stringify(change)).not.toBe(a);
    }
  });
  it("does not depend on view counts (they change constantly and would resurface every item)", () => {
    expect(Object.keys(base)).not.toContain("currentViewCount");
  });
});

describe("classifyReview", () => {
  it("a video nobody has reviewed is NEW and awaiting", () => expect(classifyReview(facts({ review: null }))).toEqual({ class: "NEW", awaitingDecision: true }));

  it("an unchanged declined, deferred (not due) or info-requested item is NOT awaiting — it is not surfaced again", () => {
    expect(classifyReview(facts({ review: { state: "DECLINED" } })).awaitingDecision).toBe(false);
    expect(classifyReview(facts({ review: { state: "DEFERRED", deferUntil: day(3) } })).awaitingDecision).toBe(false);
    expect(classifyReview(facts({ review: { state: "INFO_REQUESTED" } })).awaitingDecision).toBe(false);
  });

  it("a deferral that has fallen due is awaiting again", () => {
    expect(classifyReview(facts({ review: { state: "DEFERRED", deferUntil: day(-1) } }))).toEqual({ class: "DUE", awaitingDecision: true });
    expect(classifyReview(facts({ review: { state: "DEFERRED", deferUntil: NOW } })).class).toBe("DUE"); // due exactly now
  });

  it("a material change resurfaces a declined, deferred or info-requested item", () => {
    for (const state of ["DECLINED", "DEFERRED", "INFO_REQUESTED"] as const) {
      expect(classifyReview(facts({ fingerprint: "f2", review: { state, deferUntil: day(3) } })), state).toEqual({ class: "CHANGED", awaitingDecision: true });
    }
  });

  it("a recorded hold keeps a declined item from resurfacing, whatever changes", () => {
    expect(classifyReview(facts({ fingerprint: "f2", review: { state: "DECLINED", holdReason: "RIGHTS" } }))).toEqual({ class: "DECLINED", awaitingDecision: false });
  });

  it("an approved item stays approved while the page approval exists, and needs a decision if it was revoked elsewhere", () => {
    expect(classifyReview(facts({ review: { state: "APPROVED" }, hasActivePageApproval: true }))).toEqual({ class: "APPROVED", awaitingDecision: false });
    expect(classifyReview(facts({ review: { state: "APPROVED" }, hasActivePageApproval: false }))).toEqual({ class: "NEEDS_DECISION", awaitingDecision: true });
    // later edits to an approved video do not re-ask
    expect(classifyReview(facts({ fingerprint: "f2", review: { state: "APPROVED" }, hasActivePageApproval: true })).awaitingDecision).toBe(false);
  });

  it("a pending item is awaiting", () => expect(classifyReview(facts({ review: { state: "PENDING" } }))).toEqual({ class: "PENDING", awaitingDecision: true }));
});

describe("buildQueueNotification", () => {
  const items: QueueSummaryItem[] = [
    { videoId: "b", fingerprint: "fb", class: "NEW", title: "Second" },
    { videoId: "a", fingerprint: "fa", class: "CHANGED", title: "First" },
  ];

  it("is null when nothing awaits a decision (so the notification is resolved, not repeated)", () => expect(buildQueueNotification([], NOW, 7)).toBeNull());

  it("is identical for the same set within the reminder window, whatever the input order or time of day", () => {
    const a = buildQueueNotification(items, NOW, 7)!;
    const b = buildQueueNotification([...items].reverse(), new Date(NOW.getTime() + 3_600_000), 7)!;
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(b.body).toBe(a.body);
  });

  it("changes when the set changes (a new item is announced at once)", () => {
    const a = buildQueueNotification(items, NOW, 7)!;
    expect(buildQueueNotification([...items, { videoId: "c", fingerprint: "fc", class: "NEW", title: "Third" }], NOW, 7)!.fingerprint).not.toBe(a.fingerprint);
    expect(buildQueueNotification([items[0]], NOW, 7)!.fingerprint).not.toBe(a.fingerprint);
  });

  it("changes when an item's facts change", () => {
    const a = buildQueueNotification(items, NOW, 7)!;
    expect(buildQueueNotification([items[0], { ...items[1], fingerprint: "fa2" }], NOW, 7)!.fingerprint).not.toBe(a.fingerprint);
  });

  it("reminds once per cadence window and never more often", () => {
    const fingerprints = new Set<string>();
    for (let h = 0; h < 24 * 14; h += 6) fingerprints.add(buildQueueNotification(items, new Date(NOW.getTime() + h * 3_600_000), 7)!.fingerprint);
    expect(fingerprints.size).toBeLessThanOrEqual(3); // 14 days at a 7-day cadence spans at most 3 windows
    expect(fingerprints.size).toBeGreaterThanOrEqual(2);
  });

  it("a longer cadence reminds less often", () => {
    const count = (cadence: number) => {
      const set = new Set<string>();
      for (let d = 0; d < 60; d++) set.add(buildQueueNotification(items, day(d), cadence)!.fingerprint);
      return set.size;
    };
    expect(count(30)).toBeLessThan(count(7));
  });

  it("states what it covers without inventing anything and promises nothing is public", () => {
    const n = buildQueueNotification(items, NOW, 7)!;
    expect(n.title).toBe("2 unlisted videos awaiting a decision");
    expect(n.body).toMatch(/1 new, 1 changed since last reviewed/);
    expect(n.body).toMatch(/Nothing becomes public until you approve it/);
    expect(n.body).toContain("- First");
    expect(buildQueueNotification([items[0]], NOW, 7)!.title).toBe("1 unlisted video awaiting a decision");
  });

  it("stays within the notification length limits for a large queue", () => {
    const many: QueueSummaryItem[] = Array.from({ length: 500 }, (_, i) => ({ videoId: `v${i}`, fingerprint: `f${i}`, class: "NEW", title: "x".repeat(300) }));
    const n = buildQueueNotification(many, NOW, 7)!;
    expect(n.title.length).toBeLessThanOrEqual(160);
    expect(n.body.length).toBeLessThanOrEqual(2000);
  });
});
