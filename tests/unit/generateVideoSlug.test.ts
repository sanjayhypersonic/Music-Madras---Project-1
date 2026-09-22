import { describe, expect, it } from "vitest";
import { generateVideoSlug } from "../../modules/mmke/slug/generateVideoSlug";

describe("generateVideoSlug", () => {
  it("combines the slugified title with the lowercased YouTube video ID", () => {
    expect(generateVideoSlug("Bach Cantata", "Mx0vgJb7LOc")).toBe("bach-cantata-mx0vgjb7loc");
  });

  it("is deterministic — the same title and ID always produce the same slug", () => {
    const a = generateVideoSlug("Handel: Messiah", "gr5dB2HeY14");
    const b = generateVideoSlug("Handel: Messiah", "gr5dB2HeY14");
    expect(a).toBe(b);
  });

  it("the same YouTube ID always produces the same suffix regardless of title", () => {
    const a = generateVideoSlug("Original Title", "abc12345678");
    const b = generateVideoSlug("Renamed Title", "abc12345678");
    expect(a.endsWith("-abc12345678")).toBe(true);
    expect(b.endsWith("-abc12345678")).toBe(true);
  });

  it("a duplicate title with a different YouTube ID produces a distinct slug", () => {
    const a = generateVideoSlug("Evensong", "v1videoId12");
    const b = generateVideoSlug("Evensong", "v2videoId34");
    expect(a).not.toBe(b);
    expect(a.startsWith("evensong-")).toBe(true);
    expect(b.startsWith("evensong-")).toBe(true);
  });

  it("falls back to a 'video' base when the title is null, empty, or produces no slug characters", () => {
    expect(generateVideoSlug(null, "abc12345678")).toBe("video-abc12345678");
    expect(generateVideoSlug("", "abc12345678")).toBe("video-abc12345678");
    expect(generateVideoSlug("!!!", "abc12345678")).toBe("video-abc12345678");
  });

  it("real confirmed collision groups from the live catalogue still produce distinct slugs", () => {
    // The exact title shared by three real, distinct videos (Phase 6G pre-flight §1 finding).
    const title = "Let the song of praise the gospel chords | Samuel Joseph | TELC Arulnathar Church | Music Madras";
    const ids = ["lnYxP_R2j70", "R8QAmQQwc7c", "beS6y7Hf8fY"];
    const slugs = ids.map((id) => generateVideoSlug(title, id));
    expect(new Set(slugs).size).toBe(3);
  });

  it("slug immutability contract: a renamed title WOULD produce a different slug if regenerated — this is exactly why the repository must call generateVideoSlug only once, at creation, and never again for an existing page (proven against the real database in tests/integration/youtubeVideoPageRepository.test.ts)", () => {
    const originalSlug = generateVideoSlug("Original Concert Title", "stableId12x");
    const ifRegeneratedAfterRename = generateVideoSlug("Renamed Concert Title", "stableId12x");
    expect(originalSlug).not.toBe(ifRegeneratedAfterRename);
  });
});
