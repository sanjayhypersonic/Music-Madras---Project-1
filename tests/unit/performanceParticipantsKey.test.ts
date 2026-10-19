import { describe, expect, it } from "vitest";
import { performanceParticipantsKey } from "../../modules/publishing/performanceParticipantsKey";

// Phase 6J-10F — the participants fingerprint that guards promotion of a cloned Performance.
const base = { performers: [{ artistId: "a1", role: "Soloist" }, { artistId: "a2", role: null }], choirIds: ["c1", "c2"], conductorIds: ["k1"] };

describe("performanceParticipantsKey", () => {
  it("is stable and independent of the order the links were read in", () => {
    const reordered = { performers: [...base.performers].reverse(), choirIds: ["c2", "c1"], conductorIds: ["k1"] };
    expect(performanceParticipantsKey(reordered)).toBe(performanceParticipantsKey(base));
    expect(performanceParticipantsKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any participant is added, removed or replaced", () => {
    const k = performanceParticipantsKey(base);
    expect(performanceParticipantsKey({ ...base, performers: [...base.performers, { artistId: "a3", role: null }] })).not.toBe(k);
    expect(performanceParticipantsKey({ ...base, performers: [base.performers[0]] })).not.toBe(k);
    expect(performanceParticipantsKey({ ...base, choirIds: ["c1"] })).not.toBe(k);
    expect(performanceParticipantsKey({ ...base, conductorIds: [] })).not.toBe(k);
    expect(performanceParticipantsKey({ ...base, conductorIds: ["k2"] })).not.toBe(k);
  });

  it("changes when a performer's role changes, and treats a missing role as empty", () => {
    const k = performanceParticipantsKey(base);
    expect(performanceParticipantsKey({ ...base, performers: [{ artistId: "a1", role: "Organist" }, base.performers[1]] })).not.toBe(k);
    expect(performanceParticipantsKey({ ...base, performers: [base.performers[0], { artistId: "a2", role: "" }] })).toBe(k);
  });

  it("does not confuse the same id in different participant kinds", () => {
    expect(performanceParticipantsKey({ performers: [], choirIds: ["x"], conductorIds: [] })).not.toBe(performanceParticipantsKey({ performers: [], choirIds: [], conductorIds: ["x"] }));
    expect(performanceParticipantsKey({ performers: [{ artistId: "x", role: null }], choirIds: [], conductorIds: [] })).not.toBe(performanceParticipantsKey({ performers: [], choirIds: ["x"], conductorIds: [] }));
  });
});