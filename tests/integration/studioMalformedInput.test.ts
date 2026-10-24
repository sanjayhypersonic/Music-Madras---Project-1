import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({ getCurrentStudioSession: () => mockGetCurrentStudioSession() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { prisma } from "../../modules/db/client";
import { decodeMessage } from "../../modules/studio/decodeMessage";

// Launch workflow: Studio pages given input no row can have. A NUL byte in a route id (PostgreSQL rejects it as text) used to raise a database error and an HTTP 500
// on every Studio detail page; a bare "%" in the `?error=` text (decoded twice) raised URIError on every page that shows it. Both must now be "not found" / shown
// as text, while a visitor who is not signed in is still sent to sign in, and a real database failure is still an error (the guard only looks at the id's text).
// Pages are discovered from the source tree, so a new dynamic Studio page is covered without being listed.

const T = 180000;
const TOKEN = randomUUID().slice(0, 8);
let adminId: string;
const root = path.resolve(__dirname, "../../app/(studio)/studio/(protected)");

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...pageFiles(full));
    else if (name === "page.tsx") out.push(full);
  }
  return out;
}
const all = pageFiles(root);
const paramKeys = (file: string) => [...file.matchAll(/\[(\w+)\]/g)].map((m) => m[1]);
const dynamic = all.filter((f) => paramKeys(f).length > 0);
const staticPages = all.filter((f) => paramKeys(f).length === 0);
const label = (file: string) => path.relative(root, file).split(path.sep).join("/");

const as = (admin: boolean) => mockGetCurrentStudioSession.mockResolvedValue(admin ? { user: { id: adminId, role: "ADMINISTRATOR", status: "ACTIVE" } } : null);

type Rendered = { html: string; digest?: undefined; decoded?: undefined; error?: undefined } | { digest: string; decoded: string; html?: undefined; error?: undefined } | { error: string; html?: undefined; digest?: undefined; decoded?: undefined };
async function render(file: string, params: Record<string, string>, searchParams: Record<string, string> = {}): Promise<Rendered> {
  const mod = (await import(/* @vite-ignore */ file)) as { default: (props: unknown) => Promise<ReactElement> };
  try {
    return { html: renderToStaticMarkup(await mod.default({ params: Promise.resolve(params), searchParams: Promise.resolve(searchParams) })) };
  } catch (err) {
    const digest = (err as { digest?: unknown })?.digest;
    if (typeof digest === "string") return { digest, decoded: decodeURIComponent(digest) };
    return { error: String((err as Error)?.stack ?? err).slice(0, 400) };
  }
}
const idFor = (file: string, value: string) => Object.fromEntries(paramKeys(file).map((k) => [k, value]));

beforeAll(async () => {
  adminId = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `smi-${TOKEN}@musicmadras.test`, name: "SMI", role: "ADMINISTRATOR", status: "ACTIVE" } })).id;
}, T);
afterAll(async () => {
  await prisma.studioUser.deleteMany({ where: { id: adminId } });
}, T);

describe("the discovery itself", () => {
  it("finds the dynamic Studio routes this test is about", () => {
    expect(dynamic.length).toBeGreaterThanOrEqual(30); // 19 detail routes plus the Recording workflow steps
    for (const needle of ["catalogue/works/[id]", "catalogue/collections/[id]", "catalogue/videos/[videoId]", "audit/[id]", "recordings/[id]/review"]) {
      expect(dynamic.map(label).some((l) => l.includes(needle)), needle).toBe(true);
    }
  });
});

describe("a route id that cannot exist is not found, never a database error", () => {
  it("every dynamic Studio page, signed in, with a NUL byte or an absurd length: a not-found or a redirect, never an error", async () => {
    as(true);
    const bad: string[] = [];
    for (const file of dynamic) {
      for (const value of ["a\u0000b", "\u0000", "x".repeat(5000)]) {
        const r = await render(file, idFor(file, value));
        if ("error" in r) bad.push(`${label(file)} <- ${JSON.stringify(value.slice(0, 8))}: ${r.error}`);
        // Pages that read the row answer not-found/redirect; the Recording steps that never read it (programme, venue) render, and the workflow LAYOUT, which reads
        // the Recording, answers not-found for the whole route (pinned in studioRecordingPages.test.ts).
        else if (!label(file).startsWith("recordings/")) expect("digest" in r, `${label(file)} should not render a page for an impossible id`).toBe(true);
      }
    }
    expect(bad).toEqual([]);
  }, T);

  it("the same pages still treat an id that is well formed but absent as not found (the control)", async () => {
    as(true);
    const bad: string[] = [];
    for (const file of dynamic) {
      const r = await render(file, idFor(file, randomUUID()));
      if ("error" in r) bad.push(`${label(file)}: ${r.error}`);
    }
    expect(bad).toEqual([]);
  }, T);

  it("a visitor who is not signed in is still sent to sign in, not shown not-found", async () => {
    as(false);
    for (const file of dynamic) {
      const r = await render(file, idFor(file, "a\u0000b"));
      expect(r.decoded?.includes("/studio/signin") === true,`${label(file)}: ${JSON.stringify(r).slice(0, 160)}`).toBe(true);
    }
  }, T);

  it("the Recording programme step ignores a NUL byte in its ?programmeId= selection", async () => {
    as(true);
    const file = dynamic.find((f) => label(f) === "recordings/[id]/programme/page.tsx")!;
    const recording = await prisma.recording.findFirst({ select: { id: true } });
    // No Recording is needed to prove the query-string id is not queried: with an unknown Recording the page redirects; with one it must render.
    const r = await render(file, { id: recording?.id ?? randomUUID() }, { programmeId: "a\u0000b" });
    expect("error" in r, JSON.stringify(r).slice(0, 300)).toBe(false);
  });
});

describe("?error= text that is not valid escape syntax is shown as text, never an HTTP 500", () => {
  it("decodeMessage keeps the existing decoding and falls back to the text itself", () => {
    expect(decodeMessage("You do not have permission.")).toBe("You do not have permission.");
    expect(decodeMessage("a%20b")).toBe("a b");
    expect(decodeMessage("100%")).toBe("100%");
    expect(decodeMessage("%E0%A4%A")).toBe("%E0%A4%A");
  });

  it("no Studio page decodes the query text with a bare decodeURIComponent (a ratchet)", () => {
    const offenders = all.filter((f) => /decodeURIComponent\(/.test(readFileSync(f, "utf8"))).map(label);
    expect(offenders).toEqual([]);
  });

  it("every Studio page that takes no route id renders with ?error=50%, and the text is shown where the page shows errors", async () => {
    as(true);
    const bad: string[] = [];
    let shown = 0;
    for (const file of staticPages) {
      const r = await render(file, {}, { error: "50% of the text", notice: "x" });
      if ("error" in r) bad.push(`${label(file)}: ${r.error}`);
      else if (r.html?.includes("50% of the text")) shown++;
    }
    expect(bad).toEqual([]);
    expect(shown).toBeGreaterThan(10);
  }, T);

  it("a detail page renders ?error=50% for an entity that exists", async () => {
    as(true);
    const recording = await prisma.recording.findFirst({ select: { id: true } });
    const file = dynamic.find((f) => label(f) === "recordings/[id]/review/page.tsx")!;
    if (!recording) return; // the route-level guarantees above do not need data; this one does
    const r = await render(file, { id: recording.id }, { error: "50% of the text" });
    expect("error" in r, JSON.stringify(r).slice(0, 300)).toBe(false);
  });
});
