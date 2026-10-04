import { describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/studio/catalogue/composers/abc" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => createElement("a", { href, ...rest }, children),
}));
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), useFormStatus: () => ({ pending: false }) }));

import { StudioNav } from "../../components/studio/StudioNav";
import { ConfirmSubmitButton } from "../../components/studio/ConfirmSubmitButton";
import { StatusBadge, statusTone } from "../../components/studio/StatusBadge";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "../../components/shared/themeScript";

// Phase 6J-3B — the Studio visual system: shell, responsive behaviour, element
// defaults, primitives, state pages, the confirmation dialog, and the guard that
// no Studio file names a colour (every colour is a role in app/tokens.css).

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

function listFiles(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, pattern));
    else if (pattern.test(entry.name)) out.push(full);
  }
  return out;
}

// Each source file is read once (the drive is synced; re-reading ~80 files per test is slow).
const studioFiles = [...listFiles(path.join(root, "app/(studio)"), /\.(tsx?|css)$/), ...listFiles(path.join(root, "components/studio"), /\.tsx?$/)];
const studio = new Map(studioFiles.map((file) => [path.relative(root, file), readFileSync(file, "utf8")] as const));
const css = read("app/(studio)/studio/studio.css");
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const tokenNames = new Set([...read("app/tokens.css").matchAll(/(--mm-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

describe("no Studio file names a colour: every colour is a role", () => {
  it("has no hex, rgb() or hsl() literal in any Studio source or in studio.css", () => {
    const offenders = [...studio]
      .filter(([, text]) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  }, 30000);

  it("inline styles set colours only through var(--mm-*) (or inherit / transparent / currentColor)", () => {
    const offenders: string[] = [];
    for (const [file, text] of studio) {
      for (const block of text.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
        for (const decl of block[1].matchAll(/\b(color|background|backgroundColor|borderColor|border|borderBottom|borderTop|borderLeft|outline)\s*:\s*("[^"]*"|'[^']*')/g)) {
          const value = decl[2].slice(1, -1);
          if (/(^|\s)(var\(--mm-|inherit|transparent|currentColor|none|0)/.test(value) || !/\b(solid|dashed|dotted)\b|^[a-z#]/i.test(value)) continue;
          if (/^(solid|dashed|dotted)$/.test(value)) continue;
          offenders.push(`${file}: ${decl[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  }, 30000);

  it("studio.css only uses tokens that exist (or the next/font variable)", () => {
    const used = new Set([...cssNoComments.matchAll(/var\((--mm-[a-z0-9-]+)/g)].map((m) => m[1]));
    expect([...used].filter((name) => !tokenNames.has(name) && name !== "--mm-font-sans")).toEqual([]);
  });

  it("every studio.css rule is scoped to a .studio-* class, so it can never leak into the Museum", () => {
    const selectors = cssNoComments
      .replace(/@media[^{]*\{/g, "")
      .split("}")
      .map((chunk) => chunk.slice(0, chunk.indexOf("{")).trim())
      .filter(Boolean)
      .filter((selector) => !selector.startsWith("@"));
    // Flatten (...) groups first so a comma inside :where(a, b) is not read as a selector-list separator.
    const flatten = (selector: string) => {
      let s = selector;
      while (/\([^()]*\)/.test(s)) s = s.replace(/\([^()]*\)/g, "");
      return s;
    };
    const unscoped = selectors.filter((selector) => flatten(selector).split(",").some((part) => !part.includes(".studio-")));
    expect(unscoped).toEqual([]);
  });

  it("window.confirm is gone everywhere in the app (replaced by the accessible dialog)", () => {
    const offenders: string[] = [];
    for (const file of [...listFiles(path.join(root, "app"), /\.tsx?$/), ...listFiles(path.join(root, "components"), /\.tsx?$/)]) {
      if (/window\.confirm\s*\(|[^.\w]confirm\s*\(\s*["'`]/.test(readFileSync(file, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""))) offenders.push(path.relative(root, file));
    }
    expect(offenders).toEqual([]);
  }, 30000);
});

describe("the shell", () => {
  const layout = read("app/(studio)/studio/layout.tsx");
  const protectedLayout = read("app/(studio)/studio/(protected)/layout.tsx");

  it("carries the official logo (unmodified), the shared theme, Inter and the stylesheet", () => {
    expect(layout).toContain('import "./studio.css"');
    expect(layout).toContain("/music-madras-logo.webp");
    expect(layout).toMatch(/<ThemeToggle className="studio-icon-button"/);
    expect(layout).toContain("THEME_INIT_SCRIPT");
    expect(layout).toContain("sansFont.variable");
    expect(layout).not.toMatch(/serifFont/); // Playfair is the Museum's editorial voice; Studio is Inter only
  });

  it("the protected layout is a grid with a client navigation, not an inline two-column flex", () => {
    expect(protectedLayout).toContain("<StudioNav");
    expect(protectedLayout).toContain('className="studio-layout"');
    expect(protectedLayout).not.toMatch(/display:\s*"flex"/);
    // unchanged behaviour: the gate, the role-based links and the sign-out Server Action
    expect(protectedLayout).toMatch(/redirect\("\/studio\/signin"\)/);
    expect(protectedLayout).toContain('can(role, "AUDIT_VIEW")');
    expect(protectedLayout).toContain("signOutCurrentUser");
  });

  it("Studio and the Museum share one theme preference", () => {
    expect(THEME_INIT_SCRIPT).toContain(`"${THEME_STORAGE_KEY}"`);
    expect(read("components/shared/ThemeToggle.tsx")).toContain("THEME_STORAGE_KEY");
    expect(read("components/museum/MuseumShell.tsx")).toContain("THEME_INIT_SCRIPT");
    expect(THEME_STORAGE_KEY).toBe("musicmadras-theme"); // the Museum's existing key, so existing choices carry over
  });
});

describe("responsive behaviour (the 375px failure of the audit)", () => {
  it("below 48rem the layout is one column and the navigation becomes a disclosure", () => {
    const media = cssNoComments.slice(cssNoComments.indexOf("@media (max-width: 48rem)"));
    expect(media).toMatch(/\.studio-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(media).toMatch(/\.studio-sidebar\s*\{[^}]*position:\s*static/);
    expect(media).toMatch(/\.studio-nav__toggle\s*\{[^}]*display:\s*flex/);
    expect(media).toMatch(/\.studio-nav__panel\[data-open="false"\]\s*\{[^}]*display:\s*none/);
    expect(cssNoComments).toMatch(/\.studio-nav__toggle\s*\{\s*display:\s*none/); // hidden on wide screens
  });

  it("the content column can shrink (so wide tables scroll inside themselves) and the workflow stacks", () => {
    expect(cssNoComments).toMatch(/\.studio-layout__content\s*\{[^}]*min-width:\s*0/);
    expect(cssNoComments).toMatch(/\.studio-table-scroll\s*\{[^}]*overflow-x:\s*auto/);
    expect(cssNoComments).toMatch(/\.studio-steps-layout\s*\{[^}]*flex-direction:\s*column;[^}]*align-items:\s*stretch/);
  });

  it("every Studio table sits inside a scroll container (an intentional overflow strategy)", () => {
    const offenders = [...studio]
      .filter(([file]) => file.endsWith(".tsx"))
      .filter(([, text]) => (text.match(/<table[\s>]/g) ?? []).length !== (text.match(/studio-table-scroll/g) ?? []).length)
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  }, 30000);

  it("controls are comfortably tappable (>= 2.25rem)", () => {
    expect(cssNoComments).toMatch(/:where\(button\)\s*\{[^}]*min-height:\s*2\.25rem/);
    expect(cssNoComments).toMatch(/input:not[^{]*\{[^}]*min-height:\s*2\.25rem/);
  });
});

describe("StudioNav", () => {
  const links = [
    { href: "/studio/dashboard", label: "Dashboard" },
    { href: "/studio/catalogue", label: "Catalogue" },
    { href: "/studio/catalogue/videos", label: "YouTube Videos" },
  ];
  const html = renderToStaticMarkup(createElement(StudioNav, { links }, createElement("div", { className: "studio-account" }, "account")));

  it("renders closed on the server, so the client hydrates to identical markup", () => {
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-open="false"');
  });

  it("is a labelled navigation landmark with a real button controlling the list", () => {
    expect(html).toContain('aria-label="Studio"');
    const controls = html.match(/<button[^>]*aria-controls="([^"]+)"/)![1];
    expect(html).toContain(`id="${controls}"`);
    expect(html).toContain('type="button"');
  });

  it("marks the current section (and only it): a parent entry is current for its children, but not for a sibling entry", () => {
    expect(html).toMatch(/<a href="\/studio\/catalogue" aria-current="page">Catalogue<\/a>/);
    expect(html).not.toMatch(/href="\/studio\/dashboard"[^>]*aria-current/);
    expect(html).not.toMatch(/href="\/studio\/catalogue\/videos"[^>]*aria-current/);
  });

  it("renders the account block it is given", () => {
    expect(html).toContain("account");
  });
});

// The component requires children; createElement(…, props, children) is the idiomatic way to pass them.
const Confirm = ConfirmSubmitButton as unknown as (props: Record<string, unknown>) => React.ReactElement;

describe("the confirmation dialog (replaces window.confirm)", () => {
  it("renders an accessible modal <dialog> with the message, Cancel and Confirm", () => {
    const html = renderToStaticMarkup(createElement(Confirm, { confirmMessage: "Archive this thing?", tone: "danger" }, "Archive"));
    expect(html).toContain('<dialog class="studio-dialog"');
    expect(html).toMatch(/aria-labelledby="[^"]+"/);
    expect(html).toMatch(/aria-describedby="[^"]+"/);
    expect(html).toContain("Archive this thing?");
    expect(html).toContain("Cancel");
    expect(html).toContain("Confirm");
    expect(html).toContain('class="studio-button--danger"');
  });

  it("renders no dialog when there is nothing to confirm, and keeps the plain submit button", () => {
    const html = renderToStaticMarkup(createElement(Confirm, { pendingLabel: "Saving…" }, "Save"));
    expect(html).not.toContain("<dialog");
    expect(html).toContain('type="submit"');
  });

  it("only the presentation changed: it still submits the same form through requestSubmit with itself as the submitter, and still guards against double submit", () => {
    const source = read("components/studio/ConfirmSubmitButton.tsx").replace(/\/\/.*$/gm, "");
    expect(source).toContain("requestSubmit(button)");
    expect(source).toContain("showModal()");
    expect(source).toMatch(/disabled=\{pending\}/);
    expect(source).not.toMatch(/window\.confirm/);
  });
});

describe("status badges", () => {
  it("map statuses onto the FUNCTIONAL roles, never the brand", () => {
    expect(statusTone("PUBLISHED")).toBe("success");
    expect(statusTone("Active")).toBe("success");
    expect(statusTone("EDITOR_REVIEW")).toBe("warning");
    expect(statusTone("changes requested")).toBe("warning");
    expect(statusTone("FAILED")).toBe("error");
    expect(statusTone("Archived")).toBe("neutral");
    expect(statusTone("DRAFT")).toBe("neutral");
  });

  it("always shows the status word (colour is never the only cue)", () => {
    const html = renderToStaticMarkup(createElement(StatusBadge, { status: "PUBLISHED" }));
    expect(html).toBe('<span class="studio-badge studio-badge--success">PUBLISHED</span>');
    expect(renderToStaticMarkup(createElement(StatusBadge, { status: "Archived" }))).toBe('<span class="studio-badge">Archived</span>');
  });
});

describe("state pages", () => {
  it("Studio has its own error, not-found and loading states (it used to fall back to framework defaults)", () => {
    for (const file of ["app/(studio)/studio/error.tsx", "app/(studio)/studio/not-found.tsx", "app/(studio)/studio/(protected)/loading.tsx"]) {
      expect(existsSync(path.join(root, file)), file).toBe(true);
    }
  });

  it("the error state is a client boundary with a retry, an alert role, and never prints the message or stack", () => {
    const source = read("app/(studio)/studio/error.tsx");
    expect(source.startsWith('"use client"')).toBe(true);
    expect(source).toContain("reset()");
    expect(source).toContain('role="alert"');
    expect(source).not.toMatch(/error\.message|error\.stack/);
  });

  it("the loading state is announced politely, and the public Museum still has none (it would turn 404s into soft 200s)", () => {
    expect(read("app/(studio)/studio/(protected)/loading.tsx")).toContain('role="status"');
    expect(existsSync(path.join(root, "app/(museum)/loading.tsx"))).toBe(false);
    expect(existsSync(path.join(root, "app/loading.tsx"))).toBe(false);
  });

  it("server-side error messages shown to editors are real alerts", () => {
    const alerts = [...studio].reduce((n, [, text]) => n + (text.match(/role="alert" className="studio-alert studio-alert--error"/g) ?? []).length, 0);
    expect(alerts).toBeGreaterThanOrEqual(40);
  }, 30000);
});

describe("typography", () => {
  it("Playfair Display + Inter are retained, from one shared module", () => {
    const fonts = read("app/fonts.ts");
    expect(fonts).toContain("Playfair_Display");
    expect(fonts).toContain("Inter(");
    expect(existsSync(path.join(root, "app/(museum)/fonts.ts"))).toBe(false);
  });

  it("Studio uses Inter for everything and no display serif", () => {
    expect(cssNoComments).toContain("var(--mm-font-sans)");
    expect(cssNoComments).not.toContain("--mm-font-serif");
  });
});
