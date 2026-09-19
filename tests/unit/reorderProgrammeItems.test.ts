import { describe, expect, it } from "vitest";
import {
  computeNextOrder,
  reorderProgrammeItems,
} from "../../modules/mmke/programme/reorderProgrammeItems";

describe("computeNextOrder", () => {
  it("returns 1 for an empty programme", () => {
    expect(computeNextOrder([])).toBe(1);
  });

  it("returns one more than the current highest order", () => {
    expect(computeNextOrder([{ id: "a", order: 1 }, { id: "b", order: 3 }])).toBe(4);
  });
});

describe("reorderProgrammeItems", () => {
  const items = [
    { id: "a", order: 1 },
    { id: "b", order: 2 },
    { id: "c", order: 3 },
  ];

  it("moves an item to the front and renumbers contiguously from 1", () => {
    const result = reorderProgrammeItems(items, "c", 0);
    expect(result.map((i) => i.id)).toEqual(["c", "a", "b"]);
    expect(result.map((i) => i.order)).toEqual([1, 2, 3]);
  });

  it("moves an item to the end", () => {
    const result = reorderProgrammeItems(items, "a", 2);
    expect(result.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("does not mutate the input array", () => {
    const originalOrder = items.map((i) => i.order);
    reorderProgrammeItems(items, "b", 0);
    expect(items.map((i) => i.order)).toEqual(originalOrder);
  });

  it("clamps an out-of-range target index rather than throwing", () => {
    const result = reorderProgrammeItems(items, "a", 99);
    expect(result.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("throws if the moved item is not part of the set", () => {
    expect(() => reorderProgrammeItems(items, "does-not-exist", 0)).toThrow();
  });

  it("preserves extra fields on each item (e.g. movement/isEncore) while renumbering order", () => {
    const withExtras = [
      { id: "a", order: 1, movement: "Allegro", isEncore: false },
      { id: "b", order: 2, movement: "Adagio", isEncore: true },
    ];
    const result = reorderProgrammeItems(withExtras, "b", 0);
    expect(result).toEqual([
      { id: "b", order: 1, movement: "Adagio", isEncore: true },
      { id: "a", order: 2, movement: "Allegro", isEncore: false },
    ]);
  });
});
