import { describe, expect, it } from "vitest";
import { EDITORIAL_BLOCKS, EDITORIAL_LIMITS, findEditorialBlock, listPublishProblems, validateEditorialFieldLimits } from "../../modules/mmke/editorial/editorialBlocks";
import { parseEditorialBody } from "../../modules/mmke/editorial/editorialBody";

// Phase 6K-1 — the editorial block registry's rules and the safe body parser. Synthetic text only.

const fields = (over: Partial<{ title: string; body: string | null; seoTitle: string | null; seoDescription: string | null }> = {}) => ({ title: "T", body: "B", seoTitle: null, seoDescription: null, ...over });

describe("editorial block registry", () => {
  it("has unique slugs and every block declares its purpose and placement", () => {
    expect(new Set(EDITORIAL_BLOCKS.map((b) => b.slug)).size).toBe(EDITORIAL_BLOCKS.length);
    for (const block of EDITORIAL_BLOCKS) {
      expect(block.slug).toMatch(/^[a-z0-9-]+$/);
      expect(block.label.length).toBeGreaterThan(3);
      expect(block.purpose.length).toBeGreaterThan(15);
      expect(block.usedOn.length).toBeGreaterThan(2);
    }
  });

  it("holds no business copy: a block definition describes where content goes, never the content itself", () => {
    for (const block of EDITORIAL_BLOCKS) {
      expect(Object.keys(block).sort()).toEqual(["label", "purpose", "slug", "usedOn", "usesBody", "usesSeo"]);
    }
  });

  it("looks a block up by slug, and returns nothing for an unknown one", () => {
    expect(findEditorialBlock(EDITORIAL_BLOCKS[0].slug)).toBe(EDITORIAL_BLOCKS[0]);
    expect(findEditorialBlock("nope")).toBeUndefined();
  });
});

describe("what a block needs before it can be published", () => {
  const bodyBlock = EDITORIAL_BLOCKS.find((b) => b.usesBody)!;
  const seoBlock = EDITORIAL_BLOCKS.find((b) => b.usesSeo)!;
  const titleOnly = EDITORIAL_BLOCKS.find((b) => !b.usesBody && !b.usesSeo)!;

  it("a body block needs a title and a body", () => {
    expect(listPublishProblems(bodyBlock, fields())).toEqual([]);
    expect(listPublishProblems(bodyBlock, fields({ title: "  " }))).toContain("A title is required.");
    expect(listPublishProblems(bodyBlock, fields({ body: " \n " }))).toContain("A body is required for this block.");
    expect(listPublishProblems(bodyBlock, fields({ body: null }))).toContain("A body is required for this block.");
  });

  it("an SEO block needs an SEO title and description", () => {
    expect(listPublishProblems(seoBlock, fields({ body: null }))).toEqual(expect.arrayContaining(["An SEO title is required for this block.", "An SEO description is required for this block."]));
    expect(listPublishProblems(seoBlock, fields({ body: null, seoTitle: "A", seoDescription: "B" }))).toEqual([]);
  });

  it("a title-only block needs only its title", () => {
    expect(listPublishProblems(titleOnly, fields({ body: null }))).toEqual([]);
    expect(listPublishProblems(titleOnly, fields({ title: "", body: null }))).toEqual(["A title is required."]);
  });

  it("limits are data-integrity rules: every over-long field is reported", () => {
    const long = (n: number) => "x".repeat(n + 1);
    const problems = validateEditorialFieldLimits({ title: long(EDITORIAL_LIMITS.title), body: long(EDITORIAL_LIMITS.body), seoTitle: long(EDITORIAL_LIMITS.seoTitle), seoDescription: long(EDITORIAL_LIMITS.seoDescription) });
    expect(problems).toHaveLength(4);
    expect(validateEditorialFieldLimits({ title: "x".repeat(EDITORIAL_LIMITS.title), body: "x".repeat(EDITORIAL_LIMITS.body), seoTitle: null, seoDescription: null })).toEqual([]);
  });
});

describe("the safe body parser", () => {
  it("splits on blank lines into paragraphs and treats ## / ### lines as headings", () => {
    expect(parseEditorialBody("## Heading\n\nFirst paragraph\ncontinues here.\n\n### Sub\n\nSecond.")).toEqual([
      { type: "heading", level: 2, text: "Heading" },
      { type: "paragraph", text: "First paragraph continues here." },
      { type: "heading", level: 3, text: "Sub" },
      { type: "paragraph", text: "Second." },
    ]);
  });

  it("interprets nothing else: HTML, scripts, links and markdown stay as literal text", () => {
    const blocks = parseEditorialBody('<script>alert(1)</script>\n\n[link](javascript:alert(1)) **bold** <img src=x onerror=y>\n\n# not a heading level the parser supports');
    expect(blocks).toEqual([
      { type: "paragraph", text: "<script>alert(1)</script>" },
      { type: "paragraph", text: "[link](javascript:alert(1)) **bold** <img src=x onerror=y>" },
      { type: "paragraph", text: "# not a heading level the parser supports" },
    ]);
    // the output is data; a component renders each text value as a React text node, which escapes it
    for (const block of blocks) expect(Object.keys(block).sort()).toEqual(["text", "type"]);
  });

  it("handles empty, whitespace-only and Windows line endings, and strips control characters", () => {
    expect(parseEditorialBody(null)).toEqual([]);
    expect(parseEditorialBody("   \n\n  ")).toEqual([]);
    expect(parseEditorialBody("a\r\n\r\nb")).toEqual([{ type: "paragraph", text: "a" }, { type: "paragraph", text: "b" }]);
    expect(parseEditorialBody("a\u0000b\u0007c")).toEqual([{ type: "paragraph", text: "abc" }]);
  });

  it("a heading marker inside a multi-line chunk is plain paragraph text, not a heading", () => {
    expect(parseEditorialBody("## not a heading\nbecause of this second line")).toEqual([{ type: "paragraph", text: "## not a heading because of this second line" }]);
  });
});
