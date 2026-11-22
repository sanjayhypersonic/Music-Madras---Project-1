import { describe, expect, it } from "vitest";
import { ALTERNATE_TITLE_MAX_LENGTH, ALTERNATE_TITLES_MAX, alternateTitlesProblem, formatAlternateTitles, parseAlternateTitles } from "../../modules/mmke/workPage/alternateTitles";
import { workJsonLd } from "../../modules/mmke/workPage/workCredits";

// R-37: alternate titles typed in Studio (one per line) and emitted as JSON-LD alternateName. FAKE data only.

describe("parsing the Studio alternate-titles textarea", () => {
  it("trims each line, drops blanks and case-insensitive repeats, and keeps the first spelling typed", () => {
    const text = "  Paalan Pirandha Raavil  \r\n\r\nபாலன் பிறந்த ராவில்\n   \nPAALAN PIRANDHA RAAVIL\nA   Fake   Carol\na fake carol\n";
    expect(parseAlternateTitles(text)).toEqual(["Paalan Pirandha Raavil", "பாலன் பிறந்த ராவில்", "A Fake Carol"]);
  });

  it("keeps original scripts and Latin transliterations exactly as typed, side by side", () => {
    expect(parseAlternateTitles("டிங்கிரி டிங்காலே\nDingiri Dingalae\nDingiri Dingale")).toEqual(["டிங்கிரி டிங்காலே", "Dingiri Dingalae", "Dingiri Dingale"]);
    expect(parseAlternateTitles("Благослови, душе моя, Господа\nBlagoslovi Dushe Moya Gospoda")).toEqual(["Благослови, душе моя, Господа", "Blagoslovi Dushe Moya Gospoda"]);
  });

  it("treats the same title in composed and decomposed Unicode forms as one", () => {
    const composed = "Ave Maria à deux";
    const decomposed = "Ave Maria à deux";
    expect(parseAlternateTitles(`${composed}\n${decomposed}`)).toEqual([composed]);
  });

  it("an empty textarea clears the list, and the stored list round-trips through the textarea", () => {
    expect(parseAlternateTitles("")).toEqual([]);
    expect(parseAlternateTitles(" \n \n")).toEqual([]);
    const stored = ["Paalan Pirandha Raavil", "பாலன் பிறந்த ராவில்"];
    expect(parseAlternateTitles(formatAlternateTitles(stored))).toEqual(stored);
  });

  it("refuses an over-long title or too many titles, with the reason", () => {
    expect(alternateTitlesProblem(["A Fake Carol"])).toBeNull();
    expect(alternateTitlesProblem(["x".repeat(ALTERNATE_TITLE_MAX_LENGTH + 1)])).toMatch(/longer than 300 characters/);
    expect(alternateTitlesProblem(Array.from({ length: ALTERNATE_TITLES_MAX + 1 }, (_, i) => `Title ${i}`))).toBe("At most 30 alternate titles.");
  });
});

describe("the work page JSON-LD", () => {
  const composers = [{ id: "c1", slug: "finley-fake", name: "Finley Fake" }];
  const url = "https://example.test/works/a-fake-carol";

  it("emits alternateName as an array from the alternate titles, in stored order and spelling", () => {
    const ld = workJsonLd({ title: "பாலன் பிறந்த ராவில்", url, composers, alternateTitles: ["Paalan Pirandha Raavil", "Paalan Pirantha Raavil"] });
    expect(ld.alternateName).toEqual(["Paalan Pirandha Raavil", "Paalan Pirantha Raavil"]);
    expect(ld.name).toBe("பாலன் பிறந்த ராவில்");
  });

  it("omits alternateName when there are none", () => {
    expect(workJsonLd({ title: "A Fake Carol", url, composers })).not.toHaveProperty("alternateName");
    expect(workJsonLd({ title: "A Fake Carol", url, composers, alternateTitles: [] })).not.toHaveProperty("alternateName");
  });
});
