import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({ getCurrentStudioSession: () => mockGetCurrentStudioSession() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { attachMediaToRevision } from "../../modules/db/repositories/mediaResourceRepository";
import { archiveRecording, attachWorkToRevision, createDraftRecording, findRecordingById, forkDraftFromPublished, publishCurrentDraft, submitRecordingForReview } from "../../modules/db/repositories/recordingRepository";
import { imposeRecordingHold } from "../../modules/db/repositories/recordingHoldRepository";
import RecordingsPage from "../../app/(studio)/studio/(protected)/recordings/page";
import RecordingWorkflowLayout from "../../app/(studio)/studio/(protected)/recordings/[id]/layout";
import ReviewStepPage from "../../app/(studio)/studio/(protected)/recordings/[id]/review/page";
import ProgrammeStepPage from "../../app/(studio)/studio/(protected)/recordings/[id]/programme/page";
import VenueStepPage from "../../app/(studio)/studio/(protected)/recordings/[id]/venue/page";
import SourceStepPage from "../../app/(studio)/studio/(protected)/recordings/[id]/source/page";

// Launch workflow: what each role actually SEES on the Recording list, the workflow layout and the step pages, for every lifecycle state (draft, in review,
// published, published with a pending draft, archived, held), rendered from the real server components against the isolated test database. A hold's NOTE is
// shown only to those who may manage holds; a role that cannot change a step is told so rather than shown nothing; an archived recording says it is archived on
// every step; and an id that cannot exist is "not found", never a database error. Synthetic fixtures, removed afterwards.

const T = 120000;
const TOKEN = randomUUID().slice(0, 8);
const ROLES = { contributor: "CONTRIBUTOR", editor: "EDITOR", reviewer: "REVIEWER", admin: "ADMINISTRATOR" } as const;
type Who = keyof typeof ROLES;
const userIds = {} as Record<Who, string>;
const recordingIds: string[] = [];
let workId: string;
let composerId: string;
const NOTE = `PRIVATE-RIGHTS-NOTE-${TOKEN}`;

const as = (who: Who | null) => mockGetCurrentStudioSession.mockResolvedValue(who ? { user: { id: userIds[who], role: ROLES[who], status: "ACTIVE" } } : null);

async function html(page: (props: never) => Promise<ReactElement>, props: unknown): Promise<string> {
  return renderToStaticMarkup(await (page as unknown as (p: unknown) => Promise<ReactElement>)(props));
}
/** A rendered button with exactly this label (the guidance text mentions the same words, so a bare text match would prove nothing). */
const button = (label: string) => new RegExp(`<button[^>]*>\\s*${label}\\s*</button>`);
const params = (id: string) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });

async function failure(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    return String((err as { digest?: unknown }).digest ?? err);
  }
  return "did not throw";
}

async function newRecording(label: string, complete = true) {
  const recording = await createDraftRecording({ slug: `srp-${label}-${TOKEN}`, actorId: userIds.editor, title: `Studio page ${label} ${TOKEN}` });
  recordingIds.push(recording.id);
  const draftId = recording.currentDraftRevisionId!;
  if (complete) {
    await attachWorkToRevision(draftId, workId, userIds.editor);
    await attachMediaToRevision({ recordingRevisionId: draftId, provider: "YOUTUBE", role: "PRIMARY_VIDEO", url: `https://www.youtube.com/watch?v=srp${label}`, actorId: userIds.editor });
  }
  return { id: recording.id, title: `Studio page ${label} ${TOKEN}`, draftId };
}

const fixtures = {} as Record<"draft" | "review" | "published" | "pending" | "archived" | "held", { id: string; title: string }>;

beforeAll(async () => {
  for (const who of Object.keys(ROLES) as Who[]) {
    userIds[who] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `srp-${who}-${TOKEN}@musicmadras.test`, name: `SRP ${who}`, role: ROLES[who], status: "ACTIVE" } })).id;
  }
  composerId = (await createComposer({ slug: `srp-composer-${TOKEN}`, name: `SRP Composer ${TOKEN}`, actorId: userIds.editor })).id;
  workId = (await createMusicalWork({ slug: `srp-work-${TOKEN}`, title: `SRP Work ${TOKEN}`, composerId, actorId: userIds.editor })).id;

  fixtures.draft = await newRecording("draft");
  fixtures.review = await newRecording("review");
  await submitRecordingForReview(fixtures.review.id, userIds.editor);
  fixtures.published = await newRecording("published");
  await publishCurrentDraft(fixtures.published.id, userIds.admin);
  fixtures.pending = await newRecording("pending");
  await publishCurrentDraft(fixtures.pending.id, userIds.admin);
  await forkDraftFromPublished(fixtures.pending.id, userIds.editor);
  fixtures.archived = await newRecording("archived"); // archived WITH its open draft: archiving keeps the draft pointer
  await archiveRecording(fixtures.archived.id, userIds.admin);
  fixtures.held = await newRecording("held");
  await publishCurrentDraft(fixtures.held.id, userIds.admin);
  await imposeRecordingHold({ recordingId: fixtures.held.id, reason: "RIGHTS", note: NOTE, actorId: userIds.admin });
}, T);

afterAll(async () => {
  const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id);
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...recordingIds, ...revisionIds] } }, { actorId: { in: Object.values(userIds) } }] } });
  await prisma.mediaResource.deleteMany({ where: { recordingRevisionId: { in: revisionIds } } });
  await prisma.recording.updateMany({ where: { id: { in: recordingIds } }, data: { currentDraftRevisionId: null, currentPublishedRevisionId: null, holdReason: null, holdNote: null, holdSetAt: null, holdSetById: null } });
  await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } });
  await prisma.musicalWork.deleteMany({ where: { id: workId } });
  await prisma.composer.deleteMany({ where: { id: composerId } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(userIds) } } });
}, T);

describe("the Recording list", () => {
  it("every signed-in role sees every state, with a status badge each, and a hold marked only on the held recording", async () => {
    for (const who of Object.keys(ROLES) as Who[]) {
      as(who);
      const page = await html(RecordingsPage, { searchParams: Promise.resolve({}) });
      for (const [state, fixture] of Object.entries(fixtures)) expect(page, `${who} sees ${state}`).toContain(fixture.title);
      const row = (f: { title: string }) => page.slice(page.indexOf(f.title), page.indexOf("</tr>", page.indexOf(f.title)));
      expect(row(fixtures.held)).toContain("On hold");
      for (const other of [fixtures.draft, fixtures.published, fixtures.archived]) expect(row(other), `${who}: ${other.title}`).not.toContain("On hold");
      expect(row(fixtures.archived)).toContain("ARCHIVED");
      expect(row(fixtures.review)).toContain("IN_REVIEW");
      expect(page).not.toContain(NOTE); // the note is never on the list
    }
  });

  it("sends an unauthenticated visitor to sign in", async () => {
    as(null);
    expect(await failure(() => html(RecordingsPage, { searchParams: Promise.resolve({}) }))).toContain("/studio/signin");
  });
});

describe("the workflow layout", () => {
  const layout = (id: string) => html(RecordingWorkflowLayout, { children: createElement("p", null, "STEP-CONTENT"), params: Promise.resolve({ id }) });

  it("an archived recording says so on every step, and how to change that", async () => {
    as("editor");
    const page = await layout(fixtures.archived.id);
    expect(page).toContain("STEP-CONTENT");
    expect(page).toMatch(/This recording is archived/);
    expect(page).toMatch(/Restore it from Review &amp; Publish/);
  });

  it("a held recording is marked as held, with the kind of hold but never the note", async () => {
    for (const who of ["contributor", "admin"] as const) {
      as(who);
      const page = await layout(fixtures.held.id);
      expect(page, who).toMatch(/On hold: rights/);
      expect(page, who).not.toContain(NOTE);
    }
  });

  it("an ordinary recording carries neither notice", async () => {
    as("editor");
    for (const f of [fixtures.draft, fixtures.published]) {
      const page = await layout(f.id);
      expect(page).not.toMatch(/This recording is archived/);
      expect(page).not.toMatch(/On hold:/);
    }
  });

  it("an unknown id, and an id that cannot exist (control characters, absurd length), are not found rather than a database error", async () => {
    as("editor");
    for (const bad of [randomUUID(), "does-not-exist", "a\u0000b", "%00", "x".repeat(5000), ""]) {
      expect(await failure(() => layout(bad)), JSON.stringify(bad.slice(0, 12))).toContain("404");
    }
    expect(await findRecordingById("a\u0000b")).toBeNull();
  });
});

describe("Review & Publish never shows a hold note to someone who cannot manage holds", () => {
  it("the Administrator sees it; the Contributor, Editor and Reviewer see the hold but not the note", async () => {
    for (const who of Object.keys(ROLES) as Who[]) {
      as(who);
      const page = await html(ReviewStepPage, params(fixtures.held.id));
      expect(page, who).toMatch(/On hold: rights/);
      if (who === "admin") expect(page).toContain(NOTE);
      else expect(page, who).not.toContain(NOTE);
    }
  });

  it("controls match the role: only the Administrator is offered publish-level actions; the others are told who can", async () => {
    as("editor");
    const editor = await html(ReviewStepPage, params(fixtures.published.id));
    expect(editor).not.toMatch(button("Unpublish"));
    expect(editor).not.toMatch(button("Archive"));
    expect(editor).toMatch(/Only Administrators[^<]* can unpublish/);
    as("admin");
    const admin = await html(ReviewStepPage, params(fixtures.published.id));
    expect(admin).toMatch(button("Unpublish"));
    expect(admin).toMatch(button("Archive"));
  });

  it("submit-for-review is offered only to roles that may, and only on a draft", async () => {
    as("contributor");
    expect(await html(ReviewStepPage, params(fixtures.draft.id))).not.toMatch(button("Submit for editorial review"));
    as("editor");
    expect(await html(ReviewStepPage, params(fixtures.draft.id))).toMatch(button("Submit for editorial review"));
    expect(await html(ReviewStepPage, params(fixtures.review.id))).not.toMatch(button("Submit for editorial review"));
  });
});

describe("destructive lifecycle controls are always behind a confirmation dialog (server-rendered markup; the dialog's behaviour in a browser is not exercised here)", () => {
  it("Unpublish and Archive on a live recording, Publish on a complete draft, Restore on an archived one, and Lift the hold on a held one each carry their confirmation text", async () => {
    as("admin");
    const live = await html(ReviewStepPage, params(fixtures.published.id));
    expect(live).toMatch(/<dialog[^>]*>[\s\S]*Unpublish this recording\?/);
    expect(live).toMatch(/<dialog[^>]*>[\s\S]*Archive this recording\?/);
    const draft = await html(ReviewStepPage, params(fixtures.draft.id));
    expect(draft).toMatch(/<dialog[^>]*>[\s\S]*Publish this recording\?/);
    const archived = await html(ReviewStepPage, params(fixtures.archived.id));
    expect(archived).toMatch(/<dialog[^>]*>[\s\S]*Restore this archived recording to Draft\?/);
    const held = await html(ReviewStepPage, params(fixtures.held.id));
    expect(held).toMatch(/<dialog[^>]*>[\s\S]*Lift this hold\?/);
  });
});

describe("steps a role cannot change say so", () => {
  it("Programme and Venue: a Contributor sees the content but no form, and is told who can change it; an Editor sees the form and no notice", async () => {
    for (const [page, form] of [[ProgrammeStepPage, "Create programme"], [VenueStepPage, "Add venue"]] as const) {
      as("contributor");
      const contributor = await html(page, params(fixtures.draft.id));
      expect(contributor).not.toContain(form);
      expect(contributor).toMatch(/You can view this step but not change it\. Only Editors/);
      as("editor");
      const editor = await html(page, params(fixtures.draft.id));
      expect(editor).toContain(form);
      expect(editor).not.toContain("You can view this step but not change it");
    }
  });
});

describe("Source step states", () => {
  it("a published recording with no draft offers a new draft to those who may edit; an archived one says to restore it first and offers nothing", async () => {
    as("editor");
    const published = await html(SourceStepPage, params(fixtures.published.id));
    expect(published).toContain("Start a new draft to make changes");
    as("editor");
    const draftWithArchive = await html(SourceStepPage, params(fixtures.archived.id));
    // archived with an open draft: the layout carries the archived notice; the step itself must not invite edits it will refuse
    expect(draftWithArchive).not.toContain("Start a new draft to make changes");
  });
});
