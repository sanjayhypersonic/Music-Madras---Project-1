import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import { readFileSync, statSync } from "fs";
import path from "path";
import { composite, contrastRatio, relativeLuminance } from "../../modules/design/contrast";
import { evaluateDirection, failures } from "../../modules/design/evaluateDirection";
import { VISUAL_DIRECTIONS, type ThemeColours } from "../../modules/design/visualDirections";

// The shared semantic token system. Phase 6J-3A built it as a no-op; Phase 6J-3B
// applied the approved Direction C through it. These tests pin: the roster, the
// accessibility of every shipped role, the semantic discipline (amber = heritage,
// teal-blue = interaction, functional colours independent), that the evaluation
// data for Direction C cannot drift from what ships, and the official logo.

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

function parseTokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const stripped = block.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of stripped.matchAll(/(--mm-[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[match[1]] = match[2].trim();
  return out;
}

const tokenCss = read("app/tokens.css");
const darkStart = tokenCss.search(/^:root\s*\{/m);
const lightStart = tokenCss.search(/^:root\[data-theme="light"\]\s*\{/m);
const dark = parseTokens(tokenCss.slice(darkStart, lightStart));
const light = { ...dark, ...parseTokens(tokenCss.slice(lightStart, tokenCss.indexOf("}", lightStart))) };
const lightOverrides = parseTokens(tokenCss.slice(lightStart, tokenCss.indexOf("}", lightStart)));

const COLOUR_TOKENS = [
  // surface
  "background", "background-elevated", "surface", "surface-hover", "surface-active", "border", "border-strong", "border-hover",
  // text
  "text-primary", "text-secondary", "text-muted", "text-inverse", "heading", "link", "link-hover",
  // brand
  "brand", "brand-hover", "brand-subtle", "on-brand",
  // discovery / interaction
  "discovery", "discovery-hover", "discovery-subtle", "on-discovery", "focus",
  // heritage
  "heritage", "heritage-subtle",
  // functional
  "success", "success-subtle", "warning", "warning-subtle", "error", "error-subtle", "info", "info-subtle",
].map((name) => `--mm-${name}`);

describe("the token roster", () => {
  it("defines every semantic colour role, in both themes", () => {
    for (const token of COLOUR_TOKENS) {
      expect(dark[token], `${token} (dark)`).toBeTruthy();
      expect(lightOverrides[token], `${token} must be set explicitly for light`).toBeTruthy();
    }
  });

  it("stays deliberately small: no colour token beyond the documented roster", () => {
    const colourLike = Object.keys(dark).filter((k) => /#|rgba?\(|gradient/.test(dark[k]) && !k.startsWith("--mm-shadow"));
    expect(colourLike.sort()).toEqual([...COLOUR_TOKENS].sort());
    expect(COLOUR_TOKENS.length).toBeLessThanOrEqual(36);
  });

  it("defines the shared shape, elevation, focus, motion and spacing tokens once, for both themes", () => {
    for (const token of [
      "--mm-shadow", "--mm-shadow-sm", "--mm-shadow-md", "--mm-radius-sm", "--mm-radius-md", "--mm-radius-lg", "--mm-radius-pill",
      "--mm-focus-ring-width", "--mm-focus-ring-offset", "--mm-transition",
      "--mm-space-1", "--mm-space-2", "--mm-space-3", "--mm-space-4", "--mm-space-5", "--mm-space-6", "--mm-space-7", "--mm-space-8",
    ]) {
      expect(dark[token], token).toBeTruthy();
    }
  });

  it("names roles, never colours (no purple-500 / blue-500 style names)", () => {
    for (const token of Object.keys(dark)) expect(token, token).not.toMatch(/-(magenta|purple|lavender|blue|gold|amber|teal|red|green|orange|yellow|\d{3})(-|$)/);
  });

  it("declares the page colour scheme once, here, for both themes — never per stylesheet", () => {
    const own = tokenCss.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(own).toMatch(/color-scheme:\s*dark/);
    expect(own).toMatch(/color-scheme:\s*light/);
    expect(read("app/(museum)/museum.css")).not.toMatch(/color-scheme/);
  });
  it("is imported once, by the root layout", () => {
    expect(read("app/layout.tsx")).toMatch(/^import "\.\/tokens\.css"/m);
  });
});

// Hue of a #rrggbb colour, in degrees.
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}
function saturation(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (l > 0.5 ? 2 - max - min : max + min);
}

describe("Direction C: the semantic discipline", () => {
  const themes = { dark, light };

  for (const [name, t] of Object.entries(themes)) {
    describe(`${name} theme`, () => {
      it("amber is the logo's marigold family (heritage / archive / identity)", () => {
        for (const role of ["brand", "heritage"]) {
          const h = hue(t[`--mm-${role}`]);
          expect(h, `${role} hue`).toBeGreaterThanOrEqual(30);
          expect(h, `${role} hue`).toBeLessThanOrEqual(50);
        }
        expect(t["--mm-brand"].toLowerCase()).toBe("#f1b902"); // sampled from the official logo
      });

      it("the interaction colour is teal-leaning (kin to the logo's teal, hue ~180), not a generic product blue (hue ~210-230)", () => {
        for (const role of ["link", "link-hover", "discovery", "discovery-hover", "focus"]) {
          const h = hue(t[`--mm-${role}`]);
          expect(h, `${role} hue`).toBeGreaterThanOrEqual(185);
          expect(h, `${role} hue`).toBeLessThanOrEqual(200);
        }
      });

      it("the interaction colour is muted, not neon (saturation capped)", () => {
        for (const role of ["link", "discovery"]) expect(saturation(t[`--mm-${role}`]), role).toBeLessThanOrEqual(0.7);
      });

      it("functional colours are independent of both: info is a different hue from the interaction colour, warning is not the marigold", () => {
        expect(Math.abs(hue(t["--mm-info"]) - hue(t["--mm-link"]))).toBeGreaterThanOrEqual(25);
        expect(hue(t["--mm-warning"])).toBeLessThanOrEqual(hue(t["--mm-brand"]) - 8);
        expect(t["--mm-warning"]).not.toBe(t["--mm-heritage"]);
        expect(t["--mm-error"]).not.toBe(t["--mm-brand"]);
      });
    });
  }

  // Rules in museum.css: which selectors may use which family.
  const rules = read("app/(museum)/museum.css")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .map((chunk) => {
      const open = chunk.lastIndexOf("{");
      return open === -1 ? null : { selector: chunk.slice(chunk.lastIndexOf("\n", open - 1) + 1 === 0 ? 0 : 0, open).trim().split(/@media[^{]*\{/).pop()!.trim(), body: chunk.slice(open + 1) };
    })
    .filter((r): r is { selector: string; body: string } => Boolean(r));

  it("amber (brand / heritage) is never used on an interactive control, link or hover state", () => {
    const offenders = rules.filter((r) => /--mm-(brand|heritage)/.test(r.body) && /(^|[\s,])(a|button|input|select|textarea)\b|:hover|:focus|-button|-toggle|-pill|-input/.test(r.selector));
    expect(offenders.map((r) => r.selector)).toEqual([]);
  });

  it("the interaction colour (discovery / link) is never used for heritage markers", () => {
    const offenders = rules.filter((r) => /--mm-(discovery|link)/.test(r.body) && /eyebrow|group-heading|curator-note|category-card__status/.test(r.selector));
    expect(offenders.map((r) => r.selector)).toEqual([]);
  });

  it("the Museum's heritage markers do use amber", () => {
    for (const selector of ["eyebrow", "group-heading", "curator-note", "category-card__status"]) {
      expect(rules.some((r) => r.selector.includes(selector) && /--mm-heritage/.test(r.body)), selector).toBe(true);
    }
  });

  it("the primary button is the discovery fill with on-discovery text — not amber, not a gradient", () => {
    const button = rules.find((r) => r.selector === ".museum-button")!;
    expect(button.body).toMatch(/background:\s*var\(--mm-discovery\)/);
    expect(button.body).not.toMatch(/gradient\(/);
  });

  it("the shared shape, elevation, focus and motion tokens keep their values", () => {
    expect(dark["--mm-transition"]).toBe("180ms ease");
    expect([dark["--mm-radius-md"], dark["--mm-radius-lg"], dark["--mm-radius-pill"]]).toEqual(["0.85rem", "1rem", "999px"]);
    expect([dark["--mm-shadow-sm"], dark["--mm-shadow-md"]]).toEqual(["0 6px 18px var(--mm-shadow)", "0 8px 24px var(--mm-shadow)"]);
    expect([dark["--mm-focus-ring-width"], dark["--mm-focus-ring-offset"]]).toEqual(["2px", "3px"]);
  });

  it("museum.css holds no colour literal at all — every colour is a role", () => {
    const css = read("app/(museum)/museum.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) ?? []).toEqual([]);
  });

  it("every --mm-* variable museum.css uses is defined (by tokens.css or next/font)", () => {
    const css = read("app/(museum)/museum.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const used = new Set([...css.matchAll(/var\((--mm-[a-z0-9-]+)/g)].map((m) => m[1]));
    const provided = new Set([...Object.keys(dark), "--mm-font-serif", "--mm-font-sans"]);
    expect([...used].filter((name) => !provided.has(name))).toEqual([]);
  });

  it("no retired token name survives anywhere in the app", () => {
    const retired = /--mm-(accent|bg|surface-raised|text-accent|gradient-accent|brand-gradient|brand-glow)(?![a-z-])|var\(--mm-text\)/;
    for (const file of ["app/(museum)/museum.css", "app/tokens.css", "components/museum/MuseumShell.tsx"]) {
      expect(read(file), file).not.toMatch(retired);
    }
  });
});
describe("the shipped roles are accessible (WCAG 2.x AA)", () => {
  const themes = { dark, light };
  const hex = (value: string) => value;

  for (const [name, t] of Object.entries(themes)) {
    describe(`${name} theme`, () => {
      const surfaces = ["--mm-background", "--mm-surface", "--mm-background-elevated"].map((k) => hex(t[k]));

      it("text roles are >= 4.5:1 on every surface", () => {
        for (const role of ["text-primary", "text-secondary", "text-muted", "heading", "link", "link-hover", "heritage"]) {
          for (const surface of surfaces) expect(contrastRatio(t[`--mm-${role}`], surface), `${role} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("focus ring and control border are >= 3:1 on every surface", () => {
        for (const role of ["focus", "border-strong"]) {
          for (const surface of surfaces) expect(contrastRatio(t[`--mm-${role}`], surface), `${role} on ${surface}`).toBeGreaterThanOrEqual(3);
        }
      });

      it("text on the solid fills is >= 4.5:1 (amber brand fill, teal-blue discovery fill)", () => {
        for (const fill of ["brand", "brand-hover"]) expect(contrastRatio(t["--mm-on-brand"], t[`--mm-${fill}`]), fill).toBeGreaterThanOrEqual(4.5);
        for (const fill of ["discovery", "discovery-hover"]) expect(contrastRatio(t["--mm-on-discovery"], t[`--mm-${fill}`]), fill).toBeGreaterThanOrEqual(4.5);
      });

      it("the interaction colour is legible on its own tinted background", () => {
        const tint = `#${composite(t["--mm-discovery-subtle"], t["--mm-surface"]).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
        expect(contrastRatio(t["--mm-link"], tint)).toBeGreaterThanOrEqual(4.5);
        const heritageTint = `#${composite(t["--mm-heritage-subtle"], t["--mm-surface"]).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
        expect(contrastRatio(t["--mm-heritage"], heritageTint)).toBeGreaterThanOrEqual(4.5);
      });

      it("decorative dividers are no longer near-invisible (they were 1.07:1) yet stay soft (< 3:1)", () => {
        for (const surface of [t["--mm-background"], t["--mm-surface"]]) {
          const ratio = contrastRatio(t["--mm-border"], surface);
          expect(ratio).toBeGreaterThanOrEqual(1.5);
          expect(ratio).toBeLessThan(3);
        }
      });

      it("functional colours are >= 4.5:1 as text, on the surfaces and on their own tinted background", () => {
        for (const role of ["success", "warning", "error", "info"]) {
          for (const surface of surfaces) expect(contrastRatio(t[`--mm-${role}`], surface), `${role} on ${surface}`).toBeGreaterThanOrEqual(4.5);
          const tint = `#${composite(t[`--mm-${role}-subtle`], t["--mm-surface"]).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
          expect(contrastRatio(t[`--mm-${role}`], tint), `${role} on its tint`).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("status is never signalled by the brand: functional colours differ from every brand/identity role", () => {
        const identity = ["brand", "brand-hover", "brand-glow", "link", "heritage", "discovery"].map((r) => t[`--mm-${r}`]);
        const functional = ["success", "warning", "error", "info"].map((r) => t[`--mm-${r}`]);
        expect(new Set(functional).size).toBe(4);
        for (const f of functional) expect(identity).not.toContain(f);
      });
    });
  }
});

describe("the evaluation data for the four directions", () => {
  it("contrast maths agree with the published WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2); // the well-known AA grey
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.5);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(composite("rgba(0, 0, 0, 0.5)", "#ffffff")).toEqual([128, 128, 128]);
  });

  it("describes exactly four directions, A-D, each with a dark and a light theme of the same roles", () => {
    expect(VISUAL_DIRECTIONS.map((d) => d.id)).toEqual(["A", "B", "C", "D"]);
    const keys = (t: ThemeColours) => Object.keys(t).sort();
    for (const d of VISUAL_DIRECTIONS) expect(keys(d.dark)).toEqual(keys(d.light));
  });

  it("every direction reaches WCAG AA for every required text and indicator pairing, in dark and light", () => {
    for (const d of VISUAL_DIRECTIONS) expect(failures(evaluateDirection(d)), `Direction ${d.id}`).toEqual([]);
  });

  it("the functional palette is shared, so a state reads the same whichever direction is chosen", () => {
    for (const d of VISUAL_DIRECTIONS) expect(d.functional).toEqual(VISUAL_DIRECTIONS[0].functional);
  });

  it("direction C (the approved direction) is exactly what ships — it cannot drift from app/tokens.css", () => {
    const a = VISUAL_DIRECTIONS.find((d) => d.id === "C")!;
    for (const [themeName, tokens] of [["dark", dark], ["light", light]] as const) {
      const theme = a[themeName];
      expect(theme.background).toBe(tokens["--mm-background"]);
      expect(theme.backgroundElevated).toBe(tokens["--mm-background-elevated"]);
      expect(theme.surface).toBe(tokens["--mm-surface"]);
      expect(theme.border).toBe(tokens["--mm-border"]);
      expect(theme.borderStrong).toBe(tokens["--mm-border-strong"]);
      expect(theme.textPrimary).toBe(tokens["--mm-text-primary"]);
      expect(theme.textSecondary).toBe(tokens["--mm-text-secondary"]);
      expect(theme.textMuted).toBe(tokens["--mm-text-muted"]);
      expect(theme.link).toBe(tokens["--mm-link"]);
      expect(theme.linkHover).toBe(tokens["--mm-link-hover"]);
      expect(theme.focus).toBe(tokens["--mm-focus"]);
      expect(theme.heritage).toBe(tokens["--mm-heritage"]);
      expect(theme.discovery).toBe(tokens["--mm-discovery"]);
      expect(theme.primaryFill).toBe(tokens["--mm-discovery"]);
      expect(theme.primaryOn).toBe(tokens["--mm-on-discovery"]);
      expect(theme.discoverySubtle).toBe(tokens["--mm-discovery-subtle"]);
      expect(theme.heritageSubtle).toBe(tokens["--mm-heritage-subtle"]);
      for (const role of ["success", "warning", "error", "info"] as const) expect(a.functional[themeName][role]).toBe(tokens[`--mm-${role}`]);
    }
  });
});

describe("the official Music Madras logo is untouched", () => {
  it("is byte-for-byte the approved asset", () => {
    const file = path.join(root, "public/music-madras-logo.webp");
    expect(statSync(file).size).toBe(154604);
    expect(createHash("sha256").update(readFileSync(file)).digest("hex")).toBe("56a0a55c4bb13694a9ebd98d097d6b82b7a7fdc4830e97137505b93aaf6f3396");
  });

  it("is never recoloured by CSS (no filter, blend or colour-mix on the logo)", () => {
    const css = read("app/(museum)/museum.css").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of css.match(/\.museum-(header|hero)__logo\s*\{[^}]*\}/g) ?? []) expect(rule).not.toMatch(/filter|mix-blend|opacity|mask/);
  });
});
