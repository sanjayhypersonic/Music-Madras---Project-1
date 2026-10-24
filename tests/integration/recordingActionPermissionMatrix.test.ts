import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({ getCurrentStudioSession: () => mockGetCurrentStudioSession() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { prisma } from "../../modules/db/client";
import { can } from "../../modules/auth/policy";
import type { StudioAction } from "../../modules/auth/policy";
import { createDraftRecording } from "../../modules/db/repositories/recordingRepository";
import { saveSourceStep } from "../../app/(studio)/studio/(protected)/recordings/[id]/source/actions";
import { saveSeoStep } from "../../app/(studio)/studio/(protected)/recordings/[id]/seo/actions";
import { saveEducationalStep } from "../../app/(studio)/studio/(protected)/recordings/[id]/educational/actions";
import { attachWorkAction, detachWorkAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/works/actions";
import { attachMediaAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/media/actions";
import { createPerformanceAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/performance/actions";
import { addChoirAction, addConductorAction, addPerformerAction, discardParticipantChangesAction, removePerformerAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/participants/actions";
import { createProgrammeAction, addProgrammeItemAction, removeProgrammeItemAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/programme/actions";
import { createVenueForRecordingAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/venue/actions";
import { addToCollectionAction, attachOccasionAction, attachRightsAction, attachSourceAction, detachOccasionAction, detachRightsAction, detachSourceAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/relationships/actions";
import { startNewDraftAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/draftActions";
import { archiveAction, imposeHoldAction, liftHoldAction, publishAction, restoreAction, submitForReviewAction, unpublishAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/review/actions";
import RecordingsPage from "../../app/(studio)/studio/(protected)/recordings/page";
import VisibilityPage from "../../app/(studio)/studio/(protected)/recordings/visibility/page";
import SourcePage from "../../app/(studio)/studio/(protected)/recordings/[id]/source/page";
import ProgrammePage from "../../app/(studio)/studio/(protected)/recordings/[id]/programme/page";
import WorksPage from "../../app/(studio)/studio/(protected)/recordings/[id]/works/page";
import PerformancePage from "../../app/(studio)/studio/(protected)/recordings/[id]/performance/page";
import VenuePage from "../../app/(studio)/studio/(protected)/recordings/[id]/venue/page";
import ParticipantsPage from "../../app/(studio)/studio/(protected)/recordings/[id]/participants/page";
import EducationalPage from "../../app/(studio)/studio/(protected)/recordings/[id]/educational/page";
import MediaPage from "../../app/(studio)/studio/(protected)/recordings/[id]/media/page";
import SeoPage from "../../app/(studio)/studio/(protected)/recordings/[id]/seo/page";
import RelationshipsPage from "../../app/(studio)/studio/(protected)/recordings/[id]/relationships/page";
import ReviewPage from "../../app/(studio)/studio/(protected)/recordings/[id]/review/page";
import PreviewPage from "../../app/(studio)/studio/(protected)/recordings/[id]/preview/page";

// Launch workflow: server-side authorization of EVERY Recording Studio action and page, for an unauthenticated visitor and for each role, against the real
// actions and the isolated test database. A refused call must change nothing (no row, no audit entry) and say why; a role that holds the permission must NOT be
// refused for permission (it may be refused for other reasons: the arguments here are deliberately empty or foreign). The required permission of each action is
// declared once below and checked against the policy, so a change to the policy or to an action's guard fails here.

const T = 120000;
const TOKEN = randomUUID().slice(0, 8);
const ROLES = { contributor: "CONTRIBUTOR", editor: "EDITOR", reviewer: "REVIEWER", admin: "ADMINISTRATOR" } as const;
type Who = keyof typeof ROLES;
const userIds = {} as Record<Who, string>;
let recordingId: string;
let draftId: string;
let updatedAt: string;

type Outcome = { kind: "redirect"; url: string } | { kind: "result"; value: unknown } | { kind: "error"; message: string };
async function outcome(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { kind: "result", value: await run() };
  } catch (err) {
    const digest = (err as { digest?: unknown })?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return { kind: "redirect", url: decodeURIComponent(digest.split(";").slice(2, -2).join(";").replace(/\+/g, " ")) };
    return { kind: "error", message: String((err as Error)?.message ?? err) };
  }
}
const refusedForPermission = (o: Outcome) => (o.kind === "redirect" && /do not have permission/i.test(o.url)) || (o.kind === "result" && (o.value as { kind?: string } | undefined)?.kind === "FORBIDDEN");

const empty = () => new FormData();
const fakeId = () => randomUUID();
const as = (who: Who | null) => mockGetCurrentStudioSession.mockResolvedValue(who ? { user: { id: userIds[who], role: ROLES[who], status: "ACTIVE" } } : null);

interface Case {
  name: string;
  needs: StudioAction;
  /** Only for cases safe to run as an AUTHORIZED role with empty or foreign arguments (they cannot change the fixture). */
  harmless: boolean;
  run: () => Promise<unknown>;
}
const cases = (): Case[] => [
  { name: "saveSourceStep", needs: "RECORDING_WRITE", harmless: false, run: () => saveSourceStep(draftId, recordingId, updatedAt, { title: "x" }) },
  { name: "saveSeoStep", needs: "RECORDING_WRITE", harmless: false, run: () => saveSeoStep(draftId, recordingId, updatedAt, { seoMetaTitle: "x" }) },
  { name: "saveEducationalStep", needs: "RECORDING_WRITE", harmless: false, run: () => saveEducationalStep(draftId, recordingId, updatedAt, { educationalAnalysis: "x" }) },
  { name: "attachWorkAction", needs: "RECORDING_WRITE", harmless: true, run: () => attachWorkAction(recordingId, draftId, empty()) },
  { name: "detachWorkAction", needs: "RECORDING_WRITE", harmless: true, run: () => detachWorkAction(recordingId, draftId, fakeId()) },
  { name: "attachMediaAction", needs: "RECORDING_WRITE", harmless: true, run: () => attachMediaAction(recordingId, draftId, empty()) },
  { name: "createPerformanceAction", needs: "RECORDING_WRITE", harmless: true, run: () => createPerformanceAction(recordingId, draftId, updatedAt, empty()) },
  { name: "addPerformerAction", needs: "RECORDING_WRITE", harmless: true, run: () => addPerformerAction(recordingId, fakeId(), empty()) },
  { name: "removePerformerAction", needs: "RECORDING_WRITE", harmless: true, run: () => removePerformerAction(recordingId, fakeId(), fakeId()) },
  { name: "addChoirAction", needs: "RECORDING_WRITE", harmless: true, run: () => addChoirAction(recordingId, fakeId(), empty()) },
  { name: "addConductorAction", needs: "RECORDING_WRITE", harmless: true, run: () => addConductorAction(recordingId, fakeId(), empty()) },
  { name: "discardParticipantChangesAction", needs: "RECORDING_WRITE", harmless: true, run: () => discardParticipantChangesAction(recordingId) },
  { name: "startNewDraftAction", needs: "RECORDING_WRITE", harmless: true, run: () => startNewDraftAction(recordingId, "review") }, // already has an open draft: a no-op
  { name: "createProgrammeAction", needs: "CATALOGUE_WRITE", harmless: true, run: () => createProgrammeAction(recordingId, empty()) },
  { name: "addProgrammeItemAction", needs: "CATALOGUE_WRITE", harmless: true, run: () => addProgrammeItemAction(recordingId, fakeId(), empty()) },
  { name: "removeProgrammeItemAction", needs: "CATALOGUE_WRITE", harmless: true, run: () => removeProgrammeItemAction(recordingId, fakeId(), fakeId()) },
  { name: "createVenueForRecordingAction", needs: "CATALOGUE_WRITE", harmless: true, run: () => createVenueForRecordingAction(recordingId, empty()) },
  { name: "addToCollectionAction", needs: "CATALOGUE_WRITE", harmless: true, run: () => addToCollectionAction(recordingId, empty()) },
  { name: "attachOccasionAction", needs: "CATALOGUE_WRITE", harmless: true, run: () => attachOccasionAction(recordingId, draftId, empty()) },
  { name: "detachOccasionAction", needs: "CATALOGUE_WRITE", harmless: true, run: () => detachOccasionAction(recordingId, draftId, fakeId()) },
  { name: "attachSourceAction", needs: "CATALOGUE_WRITE", harmless: true, run: () => attachSourceAction(recordingId, draftId, empty()) },
  { name: "detachSourceAction", needs: "CATALOGUE_WRITE", harmless: true, run: () => detachSourceAction(recordingId, draftId, fakeId()) },
  { name: "attachRightsAction", needs: "CATALOGUE_WRITE", harmless: true, run: () => attachRightsAction(recordingId, draftId, empty()) },
  { name: "detachRightsAction", needs: "CATALOGUE_WRITE", harmless: true, run: () => detachRightsAction(recordingId, draftId, fakeId()) },
  { name: "submitForReviewAction", needs: "EDITORIAL_REVIEW", harmless: false, run: () => submitForReviewAction(recordingId) },
  { name: "publishAction", needs: "RECORDING_PUBLISH", harmless: true, run: () => publishAction(recordingId, fakeId()) }, // a foreign draft id: refused as stale
  { name: "unpublishAction", needs: "RECORDING_PUBLISH", harmless: true, run: () => unpublishAction(recordingId) }, // not published: refused
  { name: "restoreAction", needs: "RECORDING_PUBLISH", harmless: true, run: () => restoreAction(recordingId) }, // not archived: refused
  { name: "archiveAction", needs: "RECORDING_PUBLISH", harmless: false, run: () => archiveAction(recordingId) },
  { name: "imposeHoldAction", needs: "RECORDING_PUBLISH", harmless: true, run: () => imposeHoldAction(recordingId, empty()) }, // no kind chosen: refused
  { name: "liftHoldAction", needs: "RECORDING_PUBLISH", harmless: true, run: () => liftHoldAction(recordingId) }, // no hold: refused
];

const snapshot = async () => {
  const [recording, revisions, audits, counts] = await Promise.all([
    prisma.recording.findUniqueOrThrow({ where: { id: recordingId } }),
    prisma.recordingRevision.findMany({ where: { recordingId }, orderBy: { id: "asc" } }),
    prisma.auditLogEntry.count(),
    Promise.all([prisma.venue.count(), prisma.programme.count(), prisma.performance.count(), prisma.mediaResource.count(), prisma.collectionRecording.count(), prisma.recordingRevisionWork.count(), prisma.recordingRevisionSource.count(), prisma.recordingRevisionRights.count(), prisma.recordingRevisionOccasion.count()]),
  ]);
  return JSON.stringify({ recording, revisions, audits, counts });
};

beforeAll(async () => {
  for (const who of Object.keys(ROLES) as Who[]) {
    userIds[who] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `ram-${who}-${TOKEN}@musicmadras.test`, name: `RAM ${who}`, role: ROLES[who], status: "ACTIVE" } })).id;
  }
  const recording = await createDraftRecording({ slug: `ram-${TOKEN}`, actorId: userIds.editor, title: `Permission matrix ${TOKEN}` });
  recordingId = recording.id;
  draftId = recording.currentDraftRevisionId!;
  updatedAt = recording.currentDraftRevision!.updatedAt.toISOString();
}, T);

afterAll(async () => {
  const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId }, select: { id: true } })).map((r) => r.id);
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [recordingId, ...revisionIds] } }, { actorId: { in: Object.values(userIds) } }] } });
  await prisma.recording.updateMany({ where: { id: recordingId }, data: { currentDraftRevisionId: null, currentPublishedRevisionId: null } });
  await prisma.recording.deleteMany({ where: { id: recordingId } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(userIds) } } });
}, T);

describe("every action: refused for those without the permission, with nothing changed", () => {
  it("covers every exported action of the Recording workflow (a new action must be added to the matrix)", async () => {
    const { readdirSync, readFileSync, statSync } = await import("fs");
    const path = await import("path");
    const root = path.resolve(__dirname, "../../app/(studio)/studio/(protected)/recordings");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/(actions|Actions)\.ts$/.test(name)) files.push(full);
      }
    };
    walk(root);
    const exported = files.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/^export async function (\w+)/gm)].map((m) => m[1]));
    expect(exported.length).toBeGreaterThan(20);
    expect(cases().map((c) => c.name).sort()).toEqual([...exported].sort());
  });

  it("an unauthenticated caller is refused by every action and nothing changes", async () => {
    as(null);
    const before = await snapshot();
    for (const c of cases()) {
      const o = await outcome(c.run);
      expect(refusedForPermission(o), `${c.name}: ${JSON.stringify(o)}`).toBe(true);
    }
    expect(await snapshot()).toBe(before);
  });

  it("each role is refused exactly the actions its permissions do not cover, and nothing changes", async () => {
    for (const who of Object.keys(ROLES) as Who[]) {
      as(who);
      const denied = cases().filter((c) => !can(ROLES[who], c.needs));
      const before = await snapshot();
      for (const c of denied) {
        const o = await outcome(c.run);
        expect(refusedForPermission(o), `${who} -> ${c.name}: ${JSON.stringify(o)}`).toBe(true);
      }
      expect(await snapshot(), `${who}: refused calls changed something`).toBe(before);
    }
  });

  it("a role that holds the permission is never refused for permission (it may be refused for other reasons)", async () => {
    for (const who of Object.keys(ROLES) as Who[]) {
      as(who);
      for (const c of cases().filter((x) => x.harmless && can(ROLES[who], x.needs))) {
        const o = await outcome(c.run);
        expect(refusedForPermission(o), `${who} -> ${c.name}: ${JSON.stringify(o)}`).toBe(false);
      }
    }
  });

  it("the permission each action needs matches the policy's own roles (so a policy change is noticed here)", () => {
    expect(["CONTRIBUTOR", "EDITOR", "REVIEWER", "ADMINISTRATOR"].map((r) => can(r as never, "RECORDING_WRITE"))).toEqual([true, true, true, true]);
    expect(["CONTRIBUTOR", "EDITOR", "REVIEWER", "ADMINISTRATOR"].map((r) => can(r as never, "CATALOGUE_WRITE"))).toEqual([false, true, true, true]);
    expect(["CONTRIBUTOR", "EDITOR", "REVIEWER", "ADMINISTRATOR"].map((r) => can(r as never, "EDITORIAL_REVIEW"))).toEqual([false, true, true, true]);
    expect(["CONTRIBUTOR", "EDITOR", "REVIEWER", "ADMINISTRATOR"].map((r) => can(r as never, "RECORDING_PUBLISH"))).toEqual([false, false, false, true]);
  });
});

describe("every page: an unauthenticated visitor is sent to sign in, and nothing about the recording is rendered", () => {
  it("the list, visibility workspace and every step", async () => {
    as(null);
    const pages: Array<[string, (props: never) => Promise<unknown>]> = [
      ["list", RecordingsPage as never],
      ["visibility", VisibilityPage as never],
      ["source", SourcePage as never],
      ["programme", ProgrammePage as never],
      ["works", WorksPage as never],
      ["performance", PerformancePage as never],
      ["venue", VenuePage as never],
      ["participants", ParticipantsPage as never],
      ["educational", EducationalPage as never],
      ["media", MediaPage as never],
      ["seo", SeoPage as never],
      ["relationships", RelationshipsPage as never],
      ["review", ReviewPage as never],
      ["preview", PreviewPage as never],
    ];
    for (const [name, page] of pages) {
      const o = await outcome(() => (page as unknown as (p: unknown) => Promise<unknown>)({ params: Promise.resolve({ id: recordingId }), searchParams: Promise.resolve({}) }));
      expect(o.kind, name).toBe("redirect");
      expect((o as { url: string }).url, name).toContain("/studio/signin");
    }
  });
});
