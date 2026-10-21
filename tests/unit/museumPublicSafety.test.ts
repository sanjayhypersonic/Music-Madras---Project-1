import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import path from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/archive" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => createElement("a", { href, ...rest }, children),
}));

import { MUSEUM_NAV_LINKS } from "../../components/museum/museumNavigation";
import { MobileNav } from "../../components/museum/MobileNav";
import { MuseumNotFound } from "../../components/museum/MuseumNotFound";

// Phase 6J-1 — public navigation integrity, the mobile menu, the error/not-found
// states, and the contrast of the Museum's text/indicator role tokens.

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("public navigation never points at a page that does not exist", () => {
  it("lists exactly the seven destinations", () => {
    expect(MUSEUM_NAV_LINKS.map((l) => l.label)).toEqual(["Archive", "Videos", "Playlists", "Collections", "Learning", "Discover", "About"]);
  });

  it("every path link resolves to a real route, and every anchor to a real homepage section", () => {
    const homepage = read("app/(museum)/page.tsx");
    for (const link of MUSEUM_NAV_LINKS) {
      if (link.href.startsWith("/#")) {
        expect(homepage).toContain(`id="${link.href.slice(2)}"`);
      } else {
        expect(existsSync(path.join(root, "app/(museum)", link.href.slice(1), "page.tsx")), `${link.href} has no page`).toBe(true);
      }
    }
  });

  it("does not link Contact or Privacy pages that have no content yet", () => {
    for (const link of MUSEUM_NAV_LINKS) expect(link.label).not.toMatch(/contact|privacy/i);
    expect(existsSync(path.join(root, "app/(museum)/contact"))).toBe(false);
    expect(existsSync(path.join(root, "app/(museum)/privacy"))).toBe(false);
  });
});

describe("MobileNav", () => {
  const markup = renderToStaticMarkup(createElement(MobileNav));

  it("renders closed on the server, so the client hydrates to the identical markup", () => {
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('data-open="false"');
    expect(markup).toContain('aria-label="Open menu"');
  });

  it("uses a real button that controls a labelled navigation landmark", () => {
    const button = markup.match(/<button[^>]*>/)![0];
    const controls = button.match(/aria-controls="([^"]+)"/)![1];
    expect(markup).toContain(`id="${controls}"`);
    expect(markup).toContain('aria-label="Primary (mobile)"');
    expect(button).toContain('type="button"');
  });

  it("offers every public destination (Archive, Videos, Playlists, Collections, Learning, Discover, About)", () => {
    for (const link of MUSEUM_NAV_LINKS) {
      expect(markup).toContain(`href="${link.href}"`);
      expect(markup).toContain(`>${link.label}<`);
    }
  });
});

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("structured data and public origin are produced in one safe way everywhere", () => {
  // Each source file is read exactly once (this directory is on a synced drive; re-reading ~100 files per test is slow).
  const sources = new Map(listSourceFiles(path.join(root, "app")).map((file) => [file, readFileSync(file, "utf8")] as const));
  const relative = (file: string) => path.relative(root, file);

  it("no page injects raw JSON.stringify output into a script element — every JSON-LD block uses serializeJsonLd", () => {
    const offenders = [...sources].filter(([, text]) => /__html:\s*JSON\.stringify\(/.test(text)).map(([file]) => relative(file));
    expect(offenders).toEqual([]);

    const withJsonLd = [...sources].filter(([, text]) => text.includes("application/ld+json"));
    expect(withJsonLd.length).toBeGreaterThanOrEqual(15);
    for (const [file, text] of withJsonLd) expect(text, relative(file)).toContain("serializeJsonLd(");
  }, 30000);

  it("no page derives its public origin from AUTH_URL or hard-codes a localhost fallback", () => {
    const offenders = [...sources].filter(([, text]) => /process\.env\.AUTH_URL|\?\?\s*"http:\/\/localhost/.test(text)).map(([file]) => relative(file));
    expect(offenders).toEqual([]);
  }, 30000);

  it("no public page uses internal jargon or the inconsistent brand spelling in its copy", () => {
    for (const [file, raw] of sources) {
      if (!file.includes(`${path.sep}(museum)${path.sep}`) || !file.endsWith(".tsx")) continue;
      const text = raw.split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*")).join("\n");
      expect(text, relative(file)).not.toMatch(/MusicMadras|synchroni[sz]ation|visibility rules|canonical archive|knowledge base|Production Foundation/);
    }
  }, 30000);
});

describe("sitemap and robots reflect the live database, not a build-time snapshot", () => {
  it.each(["app/sitemap.ts", "app/robots.ts"])("%s is rendered per request", (file) => {
    expect(read(file)).toMatch(/export const dynamic = "force-dynamic"/);
  });

  it("the sitemap's entity lists all come from the shared eligibility fragments", () => {
    const repository = read("modules/db/repositories/sitemapRepository.ts");
    for (const fragment of ["eligibleComposerWhere", "eligibleWorkWhere", "eligibleVenueWhere", "eligibleProgrammeWhere", "eligiblePerformanceWhere", "eligibleArtistWhere", "eligibleChoirWhere", "eligibleConductorWhere", "eligibleOrganisationWhere"]) {
      expect(repository).toContain(fragment);
    }
    // The old "exists and is not archived" lists are gone from the sitemap.
    const sitemap = read("app/sitemap.ts");
    expect(sitemap).not.toMatch(/listActive(Composers|Artists|Choirs|Conductors|Venues|Organisations)/);
  });
});

describe("not-found / error / loading states", () => {
  it("the 404 is human, offers a way back, and exposes no internals", () => {
    const html = renderToStaticMarkup(createElement(MuseumNotFound));
    expect(html).toMatch(/couldn.{1,10}t find that page/);
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/archive"');
    expect(html).not.toMatch(/next\.js|404|stack|digest|prisma|draft|unpublished|archived/i);
  });

  it("the not-found and error state files exist, so Next never falls back to its framework defaults", () => {
    for (const file of ["app/not-found.tsx", "app/(museum)/not-found.tsx", "app/(museum)/error.tsx", "app/global-error.tsx"]) {
      expect(existsSync(path.join(root, file)), file).toBe(true);
    }
  });

  it("there is deliberately NO route-wide loading.tsx: it makes Next start streaming before notFound() can run, so every missing or non-public page would answer HTTP 200 (a soft 404) instead of 404", () => {
    expect(existsSync(path.join(root, "app/(museum)/loading.tsx"))).toBe(false);
    expect(existsSync(path.join(root, "app/loading.tsx"))).toBe(false);
  });

  it("the error states never print the error message or stack", () => {
    for (const file of ["app/(museum)/error.tsx", "app/global-error.tsx"]) {
      const source = read(file);
      expect(source).not.toMatch(/\{error\.message\}|\{error\.stack\}|error\.message\s*\}/);
    }
  });

});

// ---------------------------------------------------------------------------
// Contrast of the role tokens (WCAG 2.x relative luminance), computed from the
// stylesheet itself so a future edit that breaks them fails here.
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of block.matchAll(/--(mm-[a-z-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[match[1]] = match[2];
  return out;
}

describe("Museum colour tokens meet WCAG contrast for their role", () => {
  // Phase 6J-3A: the tokens moved to the shared app/tokens.css; museum.css now holds none.
  const css = read("app/(museum)/museum.css");
  const tokenCss = read("app/tokens.css");
  // Anchored to line starts: the stylesheet's header comment mentions :root[data-theme="light"] too.
  const darkStart = tokenCss.search(/^:root\s*\{/m);
  const lightStart = tokenCss.search(/^:root\[data-theme="light"\]\s*\{/m);
  const darkBlock = tokenCss.slice(darkStart, lightStart);
  const lightBlock = tokenCss.slice(lightStart, tokenCss.indexOf("}", lightStart));
  const dark = tokens(darkBlock);
  const light = tokens(lightBlock);
  const themes = { dark, light: { ...dark, ...light } };

  for (const [name, t] of Object.entries(themes)) {
    describe(`${name} theme`, () => {
      for (const surface of ["mm-background", "mm-surface", "mm-background-elevated"]) {
        it(`links and small accent text are >= 4.5:1 on ${surface}`, () => {
          for (const role of ["mm-link", "mm-link-hover", "mm-heritage"]) {
            expect(contrast(t[role], t[surface]), `${role} on ${surface}`).toBeGreaterThanOrEqual(4.5);
          }
        });

        it(`state-indicator borders are >= 3:1 on ${surface}`, () => {
          expect(contrast(t["mm-border-strong"], t[surface]), `mm-border-strong on ${surface}`).toBeGreaterThanOrEqual(3);
        });
      }

      it("body and muted text are >= 4.5:1 on the page background", () => {
        expect(contrast(t["mm-text-primary"], t["mm-background"])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t["mm-text-muted"], t["mm-background"])).toBeGreaterThanOrEqual(4.5);
      });

      it("text on the solid fills (discovery buttons, amber brand fill) is >= 4.5:1", () => {
        for (const fill of ["mm-discovery", "mm-discovery-hover"]) expect(contrast(t["mm-on-discovery"], t[fill]), `on ${fill}`).toBeGreaterThanOrEqual(4.5);
        for (const fill of ["mm-brand", "mm-brand-hover"]) expect(contrast(t["mm-on-brand"], t[fill]), `on ${fill}`).toBeGreaterThanOrEqual(4.5);
      });
    });
  }

  it("the approved palette: warm near-black foundation, the logo's marigold, a teal-leaning interaction colour", () => {
    expect(dark["mm-background"].toLowerCase()).toBe("#14110e");
    expect(dark["mm-brand"].toLowerCase()).toBe("#f1b902");
    expect(dark["mm-link"].toLowerCase()).toBe("#6cbdd1");
    expect(light["mm-link"].toLowerCase()).toBe("#1b6a7f");
  });

  it("no rule uses a solid FILL colour (brand marigold, discovery fill) directly as a text colour", () => {
    // Marigold is 1.7:1 on a light page and the dark discovery fill is only 4:1 on the near-black: text roles are --mm-heritage / --mm-link.
    const textRules = css.match(/[^{}]+\{[^{}]*\bcolor:\s*var\(--mm-(brand|discovery)(-hover)?\)[^{}]*\}/g) ?? [];
    expect(textRules).toEqual([]);
  });

  it("prose links are underlined, so colour is not the only cue", () => {
    expect(css).toMatch(/\.museum-root p a:not\(\.museum-button\)[\s\S]*?text-decoration:\s*underline/);
  });

  it("respects reduced motion", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});