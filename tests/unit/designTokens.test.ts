import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { composite, contrastRatio, relativeLuminance } from "../../modules/design/contrast";
import { evaluateDirection, failures } from "../../modules/design/evaluateDirection";
import { VISUAL_DIRECTIONS, type ThemeColours } from "../../modules/design/visualDirections";

// Phase 6J-3A — the shared semantic token foundation. This phase must change
// NOTHING that renders today, so the tests pin: the roster, the exact legacy
// values every Museum token resolved to before the move, accessibility of the
// shipped roles, the official logo, and that the evaluation data for the
// current palette cannot drift away from what actually ships.

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
  "brand", "brand-hover", "brand-subtle", "on-brand", "brand-gradient", "brand-glow",
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

  it("does not set color-scheme (a page-level decision owned by each surface's own stylesheet)", () => {
    expect(tokenCss.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/color-scheme/);
    const museum = read("app/(museum)/museum.css");
    expect(museum).toMatch(/:root\s*\{\s*color-scheme:\s*dark;\s*\}/);
    expect(museum).toMatch(/:root\[data-theme="light"\]\s*\{\s*color-scheme:\s*light;\s*\}/);
  });

  it("is imported once, by the root layout", () => {
    expect(read("app/layout.tsx")).toMatch(/^import "\.\/tokens\.css"/m);
  });
});

describe("the move is a no-op: every Museum token still resolves to the value it had before", () => {
  // The exact values of museum.css's own token block at commit d59addb, mapped to the role that replaced each name.
  const LEGACY: { role: string; dark: string; light: string }[] = [
    { role: "background", dark: "#1a1a2e", light: "#faf8fb" }, // --mm-bg
    { role: "surface", dark: "#211f36", light: "#ffffff" },
    { role: "background-elevated", dark: "#292640", light: "#f3eef9" }, // --mm-surface-raised
    { role: "border", dark: "rgba(201, 184, 232, 0.14)", light: "rgba(106, 59, 168, 0.16)" },
    { role: "shadow", dark: "rgba(0, 0, 0, 0.45)", light: "rgba(26, 26, 46, 0.12)" },
    { role: "text-primary", dark: "#f1eef8", light: "#1a1a2e" }, // --mm-text
    { role: "text-muted", dark: "#a9a3c2", light: "#5b5770" },
    { role: "brand", dark: "#c2185b", light: "#c2185b" }, // --mm-accent
    { role: "brand-hover", dark: "#95135a", light: "#95135a" }, // --mm-accent-deep
    { role: "brand-glow", dark: "#6a3ba8", light: "#6a3ba8" }, // --mm-accent-secondary
    { role: "border-hover", dark: "#c9b8e8", light: "#8f7ac4" }, // --mm-accent-tertiary
    { role: "on-brand", dark: "#ffffff", light: "#ffffff" }, // --mm-accent-on
    { role: "link", dark: "#c9b8e8", light: "#6a3ba8" },
    { role: "link-hover", dark: "#ece3fa", light: "#95135a" },
    { role: "heritage", dark: "#c9b8e8", light: "#6a3ba8" }, // --mm-text-accent
    { role: "border-strong", dark: "#c9b8e8", light: "#6a3ba8" },
    { role: "focus", dark: "#c9b8e8", light: "#6a3ba8" }, // the focus ring used --mm-link
  ];

  it.each(LEGACY)("--mm-$role keeps its dark and light value", ({ role, dark: d, light: l }) => {
    expect(dark[`--mm-${role}`]).toBe(d);
    expect(light[`--mm-${role}`]).toBe(l);
  });

  it("the brand gradient, motion, radii, shadows and focus ring keep their values", () => {
    expect(dark["--mm-brand-gradient"]).toBe("linear-gradient(135deg, #95135a, #6a3ba8)");
    expect(light["--mm-brand-gradient"]).toBe("linear-gradient(135deg, #95135a, #6a3ba8)");
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
    const retired = /--mm-(accent|bg|surface-raised|text-accent|gradient-accent)(?![a-z-])|var\(--mm-text\)/;
    for (const file of ["app/(museum)/museum.css", "app/tokens.css", "components/museum/MuseumShell.tsx", "app/(museum)/fonts.ts"]) {
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
        for (const role of ["text-primary", "text-secondary", "text-muted", "heading", "link", "link-hover", "heritage", "discovery", "discovery-hover"]) {
          for (const surface of surfaces) expect(contrastRatio(t[`--mm-${role}`], surface), `${role} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("focus ring and control border are >= 3:1 on every surface", () => {
        for (const role of ["focus", "border-strong"]) {
          for (const surface of surfaces) expect(contrastRatio(t[`--mm-${role}`], surface), `${role} on ${surface}`).toBeGreaterThanOrEqual(3);
        }
      });

      it("text on the solid brand fills is >= 4.5:1", () => {
        for (const fill of ["brand", "brand-hover", "brand-glow"]) expect(contrastRatio(t["--mm-on-brand"], t[`--mm-${fill}`]), fill).toBeGreaterThanOrEqual(4.5);
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

  it("direction A is exactly what ships (it cannot drift from app/tokens.css)", () => {
    const a = VISUAL_DIRECTIONS[0];
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

describe("scope: this phase does not migrate Studio", () => {
  it("no Studio file consumes the tokens yet", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(tsx?|css)$/.test(entry.name) && readFileSync(full, "utf8").includes("var(--mm-")) offenders.push(path.relative(root, full));
      }
    };
    walk(path.join(root, "app/(studio)"));
    walk(path.join(root, "components/studio"));
    expect(offenders).toEqual([]);
  }, 30000);
});
