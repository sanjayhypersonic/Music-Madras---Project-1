import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({
  getCurrentStudioSession: () => mockGetCurrentStudioSession(),
}));

import { prisma } from "../../modules/db/client";
import { createCollection } from "../../modules/db/repositories/collectionRepository";
import { createLearningGuide } from "../../modules/db/repositories/learningGuideRepository";
import { createDraftVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { publishCollectionAction, unpublishCollectionAction, archiveCollectionAction } from "../../app/(studio)/studio/(protected)/catalogue/collections/[id]/actions";
import { publishLearningGuideAction, unpublishLearningGuideAction } from "../../app/(studio)/studio/(protected)/catalogue/learning-guides/[id]/actions";
import {
  approveUnlistedPublicationAction,
  publishVideoPageAction,
  unpublishVideoPageAction,
  updateEditorialFieldsAction,
} from "../../app/(studio)/studio/(protected)/catalogue/videos/[videoId]/actions";

// Phase 6J-1 — making catalogue content public (or taking it down) needs the
// same RECORDING_PUBLISH permission as publishing a Recording; editing it keeps
// CATALOGUE_WRITE. An Editor can still edit and archive, but not publish.

const TAG = "phase6j1pub";
const TOKEN = randomUUID().slice(0, 8);
const T = 120000;

let editorId: string;
let adminId: string;
let collectionId: string;
let guideId: string;
let videoId: string;
let videoPageId: string;

function as(role: "EDITOR" | "ADMINISTRATOR") {
  mockGetCurrentStudioSession.mockResolvedValue({ user: { id: role === "ADMINISTRATOR" ? adminId : editorId, role, name: role, email: `${role}@example.test`, status: "ACTIVE" } });
}

function extractRedirectPath(err: unknown): string {
  if (typeof err === "object" && err !== null && "digest" in err) {
    const digest = (err as { digest: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return digest.split(";").slice(2, -2).join(";");
  }
  throw err;
}
async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    return decodeURIComponent(extractRedirectPath(err).replace(/\+/g, " "));
  }
  throw new Error("Action did not redirect");
}

beforeAll(async () => {
  const mk = (role: "EDITOR" | "ADMINISTRATOR") =>
    prisma.studioUser.create({ data: { id: randomUUID(), email: `${TAG}-${role.toLowerCase()}-${TOKEN}@musicmadras.test`, name: `Pub ${role}`, role, status: "ACTIVE" } });
  editorId = (await mk("EDITOR")).id;
  adminId = (await mk("ADMINISTRATOR")).id;

  collectionId = (await createCollection({ slug: `${TAG}-collection-${TOKEN}`, title: `Pub Collection ${TOKEN}`, actorId: adminId })).id;
  guideId = (await createLearningGuide({ slug: `${TAG}-guide-${TOKEN}`, title: `Pub Guide ${TOKEN}`, actorId: adminId })).id;
  const video = await prisma.youTubeVideo.create({
    data: { youtubeVideoId: `${TAG}-${TOKEN}`, title: `Pub Video ${TOKEN}`, privacyStatus: "unlisted", observabilityState: "OBSERVED" },
  });
  videoId = video.id;
  videoPageId = (await createDraftVideoPage({ youtubeVideoId: video.id, actorId: adminId })).id;
}, T);

afterAll(async () => {
  for (const [type, id] of [["Collection", collectionId], ["LearningGuide", guideId], ["YouTubeVideoPage", videoPageId]] as const) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: type, entityId: id } });
  }
  await prisma.collection.deleteMany({ where: { id: collectionId } });
  await prisma.learningGuide.deleteMany({ where: { id: guideId } });
  await prisma.youTubeVideoPage.deleteMany({ where: { id: videoPageId } });
  await prisma.youTubeVideo.deleteMany({ where: { id: videoId } });
  await prisma.auditLogEntry.deleteMany({ where: { actorId: { in: [editorId, adminId] } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: [editorId, adminId] } } });
}, T);

describe("publishing catalogue content needs RECORDING_PUBLISH", () => {
  it("collections: an Editor cannot publish or unpublish; an Administrator can", async () => {
    as("EDITOR");
    expect(await redirectOf(() => publishCollectionAction(collectionId))).toMatch(/permission/i);
    expect((await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })).status).toBe("DRAFT");

    as("ADMINISTRATOR");
    await redirectOf(() => publishCollectionAction(collectionId));
    expect((await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })).status).toBe("PUBLISHED");

    as("EDITOR");
    expect(await redirectOf(() => unpublishCollectionAction(collectionId))).toMatch(/permission/i);
    expect((await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })).status).toBe("PUBLISHED");

    as("ADMINISTRATOR");
    await redirectOf(() => unpublishCollectionAction(collectionId));
    expect((await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })).status).toBe("DRAFT");
  }, T);

  it("collections: an Editor can still archive (a catalogue edit); only publishing moved", async () => {
    as("EDITOR");
    await redirectOf(() => archiveCollectionAction(collectionId));
    expect((await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })).archivedAt).not.toBeNull();
  }, T);

  it("learning guides: an Editor cannot publish or unpublish; an Administrator can", async () => {
    as("EDITOR");
    expect(await redirectOf(() => publishLearningGuideAction(guideId))).toMatch(/permission/i);
    expect((await prisma.learningGuide.findUniqueOrThrow({ where: { id: guideId } })).status).toBe("DRAFT");

    as("ADMINISTRATOR");
    await redirectOf(() => publishLearningGuideAction(guideId));
    expect((await prisma.learningGuide.findUniqueOrThrow({ where: { id: guideId } })).status).toBe("PUBLISHED");

    as("EDITOR");
    expect(await redirectOf(() => unpublishLearningGuideAction(guideId))).toMatch(/permission/i);
    expect((await prisma.learningGuide.findUniqueOrThrow({ where: { id: guideId } })).status).toBe("PUBLISHED");
  }, T);

  it("video catalogue pages: an Editor cannot publish, unpublish or approve an unlisted video; an Administrator can; editing stays open to Editors", async () => {
    as("EDITOR");
    expect(await redirectOf(() => publishVideoPageAction(videoId, videoPageId))).toMatch(/permission/i);
    expect(await redirectOf(() => approveUnlistedPublicationAction(videoId, videoPageId))).toMatch(/permission/i);
    let page = await prisma.youTubeVideoPage.findUniqueOrThrow({ where: { id: videoPageId } });
    expect(page.status).toBe("DRAFT");
    expect(page.unlistedPublicationApprovedAt).toBeNull();

    // Editing the editorial fields is still a CATALOGUE_WRITE action.
    const form = new FormData();
    form.set("curatorNote", "An editor's note");
    await redirectOf(() => updateEditorialFieldsAction(videoId, videoPageId, form));
    expect((await prisma.youTubeVideoPage.findUniqueOrThrow({ where: { id: videoPageId } })).curatorNote).toBe("An editor's note");

    as("ADMINISTRATOR");
    await redirectOf(() => publishVideoPageAction(videoId, videoPageId));
    await redirectOf(() => approveUnlistedPublicationAction(videoId, videoPageId));
    page = await prisma.youTubeVideoPage.findUniqueOrThrow({ where: { id: videoPageId } });
    expect(page.status).toBe("PUBLISHED");
    expect(page.unlistedPublicationApprovedAt).not.toBeNull();

    as("EDITOR");
    expect(await redirectOf(() => unpublishVideoPageAction(videoId, videoPageId))).toMatch(/permission/i);
    expect((await prisma.youTubeVideoPage.findUniqueOrThrow({ where: { id: videoPageId } })).status).toBe("PUBLISHED");
  }, T);
});
