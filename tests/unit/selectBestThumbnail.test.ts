import { describe, expect, it } from "vitest";
import { selectBestThumbnail } from "../../modules/youtube/sync-engine/selectBestThumbnail";

describe("selectBestThumbnail", () => {
  it("prefers maxres over every other resolution", () => {
    const url = selectBestThumbnail({
      default: { url: "d" },
      medium: { url: "m" },
      high: { url: "h" },
      standard: { url: "s" },
      maxres: { url: "mr" },
    });
    expect(url).toBe("mr");
  });

  it("falls back to standard when maxres is absent", () => {
    const url = selectBestThumbnail({ default: { url: "d" }, high: { url: "h" }, standard: { url: "s" } });
    expect(url).toBe("s");
  });

  it("falls back to default when nothing else is present", () => {
    const url = selectBestThumbnail({ default: { url: "d" } });
    expect(url).toBe("d");
  });

  it("returns null for an empty thumbnail set", () => {
    expect(selectBestThumbnail({})).toBeNull();
  });

  it("returns null for undefined/null input", () => {
    expect(selectBestThumbnail(undefined)).toBeNull();
    expect(selectBestThumbnail(null)).toBeNull();
  });
});
