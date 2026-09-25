import { describe, expect, it } from "vitest";
import { buildArchiveHref, normalizeArchiveType, parseArchivePage } from "../../modules/mmke/archiveSearch/archiveUrlState";

describe("normalizeArchiveType", () => {
  it("returns null type, not invalid, when no type is given (means 'all')", () => {
    expect(normalizeArchiveType(undefined)).toEqual({ type: null, invalid: false });
    expect(normalizeArchiveType("")).toEqual({ type: null, invalid: false });
    expect(normalizeArchiveType("   ")).toEqual({ type: null, invalid: false });
  });

  it("accepts singular and plural forms, case-insensitively", () => {
    expect(normalizeArchiveType("work")).toEqual({ type: "work", invalid: false });
    expect(normalizeArchiveType("works")).toEqual({ type: "work", invalid: false });
    expect(normalizeArchiveType("WORKS")).toEqual({ type: "work", invalid: false });
    expect(normalizeArchiveType("Composer")).toEqual({ type: "composer", invalid: false });
    expect(normalizeArchiveType("composers")).toEqual({ type: "composer", invalid: false });
    expect(normalizeArchiveType("recording")).toEqual({ type: "recording", invalid: false });
    expect(normalizeArchiveType("recordings")).toEqual({ type: "recording", invalid: false });
    expect(normalizeArchiveType("venue")).toEqual({ type: "venue", invalid: false });
    expect(normalizeArchiveType("venues")).toEqual({ type: "venue", invalid: false });
    expect(normalizeArchiveType("programme")).toEqual({ type: "programme", invalid: false });
    expect(normalizeArchiveType("programmes")).toEqual({ type: "programme", invalid: false });
    expect(normalizeArchiveType("PROGRAMMES")).toEqual({ type: "programme", invalid: false });
    expect(normalizeArchiveType("performance")).toEqual({ type: "performance", invalid: false });
    expect(normalizeArchiveType("performances")).toEqual({ type: "performance", invalid: false });
    expect(normalizeArchiveType("PERFORMANCES")).toEqual({ type: "performance", invalid: false });
    expect(normalizeArchiveType("artist")).toEqual({ type: "artist", invalid: false });
    expect(normalizeArchiveType("artists")).toEqual({ type: "artist", invalid: false });
    expect(normalizeArchiveType("ARTISTS")).toEqual({ type: "artist", invalid: false });
    expect(normalizeArchiveType("choir")).toEqual({ type: "choir", invalid: false });
    expect(normalizeArchiveType("choirs")).toEqual({ type: "choir", invalid: false });
    expect(normalizeArchiveType("conductor")).toEqual({ type: "conductor", invalid: false });
    expect(normalizeArchiveType("conductors")).toEqual({ type: "conductor", invalid: false });
  });

  it("flags an unrecognized type as invalid, never guessing a type", () => {
    expect(normalizeArchiveType("soloist")).toEqual({ type: null, invalid: true });
    expect(normalizeArchiveType("nonsense")).toEqual({ type: null, invalid: true });
  });
});

describe("buildArchiveHref", () => {
  it("builds the bare /archive URL when nothing is set", () => {
    expect(buildArchiveHref({})).toBe("/archive");
  });

  it("carries q forward", () => {
    expect(buildArchiveHref({ q: "bach" })).toBe("/archive?q=bach");
  });

  it("carries type forward", () => {
    expect(buildArchiveHref({ type: "work" })).toBe("/archive?type=work");
  });

  it("carries q and type together, in stable order", () => {
    expect(buildArchiveHref({ q: "bach", type: "work" })).toBe("/archive?q=bach&type=work");
  });

  it("never writes page=1 explicitly", () => {
    expect(buildArchiveHref({ q: "bach", page: 1 })).toBe("/archive?q=bach");
  });

  it("writes page when it is greater than 1", () => {
    expect(buildArchiveHref({ q: "bach", type: "work", page: 3 })).toBe("/archive?q=bach&type=work&page=3");
  });

  it("URL-encodes special characters in the query", () => {
    expect(buildArchiveHref({ q: "jesu, joy" })).toBe("/archive?q=jesu%2C+joy");
  });
});

describe("parseArchivePage", () => {
  it("defaults to 1 when no page is given", () => {
    expect(parseArchivePage(undefined)).toBe(1);
  });

  it("parses a valid page number", () => {
    expect(parseArchivePage("3")).toBe(3);
  });

  it("clamps a non-positive or malformed page to 1, never throwing", () => {
    expect(parseArchivePage("0")).toBe(1);
    expect(parseArchivePage("-5")).toBe(1);
    expect(parseArchivePage("not-a-number")).toBe(1);
    expect(parseArchivePage("")).toBe(1);
  });

  it("floors a fractional page", () => {
    expect(parseArchivePage("2.9")).toBe(2);
  });
});
