import { describe, expect, it } from "vitest";
import { isNonPersonName, isTranslatedTitleLabel, isTranslatorLabel } from "../../modules/mmke/people/personNames";
import { roleOf } from "../../modules/jobs/videoCreditsApproved";

// R-38: who is a person. FAKE data only.

describe("names that are never a person", () => {
  it("Traditional, Anonymous, Unknown and Various, in any letter case and with an arrangement suffix", () => {
    for (const n of ["Traditional", "traditional", "TRADITIONAL", " Traditional. ", "Anonymous", "Unknown", "Various", "Traditional (arr.)", "Traditional (arr. J. Smith)", "Traditional [arr. Fake Arranger]", "Traditional, arr. Ann Example", "Traditional arranged by Ann Example", "Anonymous (Arr.)"]) {
      expect(isNonPersonName(n), n).toBe(true);
    }
  });

  it("never catches a real name that merely contains or resembles one of those words", () => {
    for (const n of ["Traditional Choir of Fakeville", "Ann Unknown-Smith", "Various Artists Trust", "Arrigo Boito", "Barry Arrowsmith", "Finley Abraham", "J. Cooling Rajaiah"]) {
      expect(isNonPersonName(n), n).toBe(false);
    }
  });
});

describe("translator labels", () => {
  it("only Translator and Translated by credit a person", () => {
    expect(isTranslatorLabel("Translator")).toBe(true);
    expect(isTranslatorLabel("TRANSLATED BY")).toBe(true);
    expect(isTranslatorLabel("  translated   by ")).toBe(true);
    expect(isTranslatorLabel("Translation")).toBe(false);
    expect(isTranslatorLabel("Translated title")).toBe(false);
  });

  it("every other label starting Translat… is a translated title, and the review sheet's labels read the same way", () => {
    expect(isTranslatedTitleLabel("Translation")).toBe(true);
    expect(isTranslatedTitleLabel("Translated title")).toBe(true);
    expect(isTranslatedTitleLabel("Translator")).toBe(false);
    expect(isTranslatedTitleLabel("Composer")).toBe(false);
    expect(isTranslatorLabel(roleOf("UNMODELLED Translator"))).toBe(true);
    expect(isTranslatedTitleLabel(roleOf("UNMODELLED Translation"))).toBe(true);
    expect(isTranslatorLabel(roleOf('UNMODELLED Translated by (label "Translated by")'))).toBe(true);
  });
});
