import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// `after()` (used by the pages for analytics) only exists inside a real request.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: () => {} };
});

import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { attachWorkToRevision, createDraftRecording, publishCurrentDraft } from "../../modules/db/repositories/recordingRepository";
import ComposerPage from "../../app/(museum)/composers/[slug]/page";

// Phase 6J-1 — a hostile composer name (</script> + markup) must not be able to
// break out of the JSON-LD <script> on the real public page. Real database,
// real page component, rendered to HTML; disposable fixtures.

const TAG = "phase6j1ld";
const TOKEN = randomUUID().slice(0, 8);
const T = 120000;
const HOSTILE = `Hostile </script><script>window.__pwned=1</script><img src=x onerror=alert(1)> ${TOKEN}`;

let userId: string;
let composerId: string;
let workId: string;
let recordingId: string;
let composerSlug: string;

beforeAll(async () => {
  const user = await prisma.studioUser.create({ data: { id: randomUUID(), email: `${TAG}-${TOKEN}@musicmadras.test`, name: "JSON-LD Test", role: "EDITOR", status: "ACTIVE" } });
  userId = user.id;
  const composer = await createComposer({ slug: `${TAG}-composer-${TOKEN}`, name: HOSTILE, actorId: userId });
  composerId = composer.id;
  composerSlug = composer.slug;
  const work = await createMusicalWork({ slug: `${TAG}-work-${TOKEN}`, title: `Safe Work ${TOKEN}`, composerId, actorId: userId });
  workId = work.id;
  const draft = await createDraftRecording({ slug: `${TAG}-recording-${TOKEN}`, actorId: userId, title: `Safe Recording ${TOKEN}` });
  recordingId = draft.id;
  await attachWorkToRevision(draft.currentDraftRevision!.id, workId, userId);
  await publishCurrentDraft(recordingId, userId); // makes the composer publicly eligible
}, T);

afterAll(async () => {
  const revisions = await prisma.recordingRevision.findMany({ where: { recordingId }, select: { id: true } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: recordingId } });
  if (revisions.length) await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
  await prisma.recording.deleteMany({ where: { id: recordingId } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: workId } });
  await prisma.musicalWork.deleteMany({ where: { id: workId } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: composerId } });
  await prisma.composer.deleteMany({ where: { id: composerId } });
  await prisma.auditLogEntry.deleteMany({ where: { actorId: userId } });
  await prisma.studioUser.deleteMany({ where: { id: userId } });
}, T);

describe("JSON-LD on a real public page", () => {
  it("a composer name containing </script> cannot terminate the structured-data script or inject markup", async () => {
    const element = await ComposerPage({ params: Promise.resolve({ slug: composerSlug }) });
    const html = renderToStaticMarkup(createElement("div", null, element as never));

    // Exactly one JSON-LD script, and its content is a single, inert line of JSON.
    const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    const body = scripts[0][1];
    expect(body).not.toMatch(/<|>/);

    // It still decodes to the real name — the semantics are unchanged.
    expect(JSON.parse(body).name).toBe(HOSTILE);

    // The name is shown on the page as ESCAPED TEXT (React escapes it), never as live markup:
    // no raw <script> or <img> from the hostile value exists anywhere in the document.
    const withoutJsonLd = html.replace(scripts[0][0], "");
    expect(withoutJsonLd).not.toContain("<script>window.__pwned");
    expect(withoutJsonLd).not.toContain("<img src=x");
    expect(withoutJsonLd).toContain("&lt;/script&gt;&lt;script&gt;window.__pwned=1&lt;/script&gt;");
    expect([...html.matchAll(/<script/g)]).toHaveLength(1); // only our own JSON-LD element
  }, T);
});
