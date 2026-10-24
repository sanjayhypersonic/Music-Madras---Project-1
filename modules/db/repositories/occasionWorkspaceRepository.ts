import { prisma } from "../client";
import { isRecordingPubliclyVisible } from "../../mmke/catalogue/isRecordingPublished";
import {
  classifyCollection,
  classifyPerformance,
  classifyProgramme,
  classifyRecording,
  sortConnections,
  summarisePublicPage,
  underArchivedOccasion,
  type Classification,
  type ConnectedItem,
  type ConnectionVia,
  type PublicPageSummary,
} from "../../mmke/occasionWorkspace/occasionConnections";
import { PUBLIC_COLLECTION_WHERE } from "./collectionRepository";
import { listEntitiesForOccasion } from "./occasionRepository";
import { PUBLISHED_REVISION_WHERE, RECORDING_NOT_HELD_WHERE, eligiblePerformanceWhere, eligibleProgrammeWhere } from "./publicEligibility";

// The Studio Occasion workspace's READER: everything connected to one Occasion and, for each item, whether it is on the public Occasion page and why not.
//
// READ-ONLY and separate from the public readers (occasionPageRepository.ts): it creates no draft, writes nothing, and its result is only ever shown in Studio.
// It does NOT define "public" a second time. Visibility is asked of the database with the same fragments the public page uses — eligiblePerformanceWhere,
// eligibleProgrammeWhere, PUBLIC_COLLECTION_WHERE, PUBLISHED_REVISION_WHERE and isRecordingPubliclyVisible — and the facts loaded beside it only EXPLAIN a "no"
// (modules/mmke/occasionWorkspace/occasionConnections.ts). A Recording's occasion is read from the REVISION-SCOPED table (recording_revision_occasions): from its
// PUBLISHED revision for what is public, and from its open draft revision only to say "linked in the draft". The frozen legacy Recording-level rows are not read
// (listEntitiesForOccasion never returns them), so a legacy row can neither connect an item nor make an Occasion public.
//
// Queries are batched (a fixed number however many items are linked), each list bounded by LIST_LIMIT; `truncated` says when a bound was reached.

const LIST_LIMIT = 200;

export interface OccasionWorkspace {
  occasion: { id: string; slug: string; name: string; description: string | null; archivedAt: Date | null; createdAt: Date; updatedAt: Date };
  publicPage: PublicPageSummary & { href: string | null };
  connections: ConnectedItem[];
  counts: { linked: number; visible: number };
  /** True when a list reached its bound, so the workspace is showing a part of what is linked. */
  truncated: boolean;
}

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function loadOccasionWorkspace(occasionId: string): Promise<OccasionWorkspace | null> {
  const occasion = await prisma.occasion.findUnique({ where: { id: occasionId } });
  if (!occasion) return null;
  const occasionArchived = occasion.archivedAt !== null;

  const links = await listEntitiesForOccasion(occasion.id);
  const idsOf = (type: "PROGRAMME" | "PERFORMANCE" | "COLLECTION") => links.filter((l) => l.entityType === type).map((l) => l.entityId);
  const taggedPerformanceIds = idsOf("PERFORMANCE");
  const taggedProgrammeIds = idsOf("PROGRAMME");
  const taggedCollectionIds = idsOf("COLLECTION");
  const performanceWhere = { OR: [{ id: { in: taggedPerformanceIds } }, { programmeId: { in: taggedProgrammeIds } }] };
  const anyPerformances = taggedPerformanceIds.length + taggedProgrammeIds.length > 0;

  const [performanceFacts, visiblePerformanceRows, programmeFacts, visibleProgrammeRows, collectionFacts, visibleCollectionRows, revisionLinks, publishedCarry] = await Promise.all([
    anyPerformances
      ? prisma.performance.findMany({
          where: performanceWhere,
          select: {
            id: true,
            slug: true,
            performanceDate: true,
            archivedAt: true,
            programmeId: true,
            programme: { select: { title: true, archivedAt: true } },
            venue: { select: { name: true, archivedAt: true } },
            revisions: { where: PUBLISHED_REVISION_WHERE, select: { id: true }, take: 1 },
          },
          orderBy: [{ performanceDate: { sort: "desc", nulls: "last" } }, { id: "asc" }],
          take: LIST_LIMIT,
        })
      : Promise.resolve([]),
    anyPerformances ? prisma.performance.findMany({ where: { AND: [performanceWhere, eligiblePerformanceWhere] }, select: { id: true }, take: LIST_LIMIT }) : Promise.resolve([]),
    taggedProgrammeIds.length > 0 ? prisma.programme.findMany({ where: { id: { in: taggedProgrammeIds } }, select: { id: true, slug: true, title: true, archivedAt: true }, orderBy: [{ title: "asc" }, { id: "asc" }], take: LIST_LIMIT }) : Promise.resolve([]),
    taggedProgrammeIds.length > 0 ? prisma.programme.findMany({ where: { AND: [{ id: { in: taggedProgrammeIds } }, eligibleProgrammeWhere] }, select: { id: true }, take: LIST_LIMIT }) : Promise.resolve([]),
    taggedCollectionIds.length > 0 ? prisma.collection.findMany({ where: { id: { in: taggedCollectionIds } }, select: { id: true, slug: true, title: true, status: true, archivedAt: true }, orderBy: [{ title: "asc" }, { id: "asc" }], take: LIST_LIMIT }) : Promise.resolve([]),
    taggedCollectionIds.length > 0 ? prisma.collection.findMany({ where: { id: { in: taggedCollectionIds }, ...PUBLIC_COLLECTION_WHERE }, select: { id: true }, take: LIST_LIMIT }) : Promise.resolve([]),
    // Revision-scoped: which Recordings' revisions carry this Occasion, and whether that revision is the open draft.
    prisma.recordingRevisionOccasion.findMany({ where: { occasionId: occasion.id }, select: { revision: { select: { recordingId: true, currentDraftOf: { select: { id: true } }, currentPublishedOf: { select: { id: true } } } } }, take: LIST_LIMIT }),
    // The same published-revision rule as the public page.
    prisma.recordingRevisionOccasion.findMany({ where: { occasionId: occasion.id, revision: PUBLISHED_REVISION_WHERE }, select: { revision: { select: { recordingId: true } } }, take: LIST_LIMIT }),
  ]);

  const visiblePerformanceIds = new Set(visiblePerformanceRows.map((r) => r.id));
  const visibleProgrammeIds = new Set(visibleProgrammeRows.map((r) => r.id));
  const visibleCollectionIds = new Set(visibleCollectionRows.map((r) => r.id));

  // Recordings the public page lists because they record a listed (public) Performance: the same query the page runs.
  const derivedRevisions =
    visiblePerformanceIds.size === 0 ? [] : await prisma.recordingRevision.findMany({ where: { AND: [PUBLISHED_REVISION_WHERE, { performanceId: { in: [...visiblePerformanceIds] } }] }, select: { recordingId: true }, take: LIST_LIMIT });

  // Which of these Performances (and so Programmes) have a PUBLISHED Recording that a Recording hold withholds. Used only to EXPLAIN a "not public" verdict: it asks
  // the canonical rules directly (published = the Recording's own status PUBLISHED with its published revision; held = NOT the not-held fragment), and is never
  // inferred from missing public data.
  const shownPerformanceIds = performanceFacts.map((p) => p.id);
  const heldRevisions =
    shownPerformanceIds.length === 0
      ? []
      : await prisma.recordingRevision.findMany({
          where: { performanceId: { in: shownPerformanceIds }, currentPublishedOf: { is: { status: "PUBLISHED", NOT: RECORDING_NOT_HELD_WHERE } } },
          select: { performanceId: true, performance: { select: { programmeId: true } } },
          take: LIST_LIMIT,
        });
  const heldPerformanceIds = new Set(heldRevisions.flatMap((r) => (r.performanceId ? [r.performanceId] : [])));
  const heldProgrammeIds = new Set(heldRevisions.flatMap((r) => (r.performance ? [r.performance.programmeId] : [])));

  const draftCarry = new Set(revisionLinks.filter((l) => l.revision.currentDraftOf !== null).map((l) => l.revision.recordingId));
  // Which Recordings' CURRENT published revision (by pointer, whatever the recording's status now is) carries the Occasion: used only to EXPLAIN an exclusion
  // (an unpublished or archived recording whose published revision carries it). What is PUBLIC is decided by publishedCarryIds (the page's own fragment).
  const pointerCarry = new Set(revisionLinks.filter((l) => l.revision.currentPublishedOf !== null).map((l) => l.revision.recordingId));
  const publishedCarryIds = new Set(publishedCarry.map((l) => l.revision.recordingId));
  const derivedIds = new Set(derivedRevisions.map((r) => r.recordingId));
  const linkedRecordingIds = new Set(revisionLinks.map((l) => l.revision.recordingId));
  const allRecordingIds = [...new Set([...linkedRecordingIds, ...derivedIds])];

  const recordingRows =
    allRecordingIds.length === 0
      ? []
      : await prisma.recording.findMany({
          where: { id: { in: allRecordingIds } },
          select: {
            id: true,
            slug: true,
            status: true,
            currentPublishedRevisionId: true,
            holdReason: true,
            currentPublishedRevision: { select: { title: true } },
            currentDraftRevision: { select: { title: true } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: LIST_LIMIT,
        });

  const wrap = (own: Classification): Classification => (occasionArchived ? underArchivedOccasion(own) : own);
  const items: ConnectedItem[] = [];

  const directPerformance = new Set(taggedPerformanceIds);
  for (const p of performanceFacts) {
    const via: ConnectionVia = directPerformance.has(p.id) ? "DIRECT" : "VIA_PROGRAMME";
    const own = classifyPerformance({ visible: visiblePerformanceIds.has(p.id), archived: p.archivedAt !== null, programmeArchived: p.programme.archivedAt !== null, venueArchived: p.venue.archivedAt !== null, hasPublishedRecording: p.revisions.length > 0, hasHeldRecording: heldPerformanceIds.has(p.id) });
    const c = wrap(own);
    items.push({
      kind: "PERFORMANCE",
      id: p.id,
      label: `${isoDate(p.performanceDate) ?? "Date unknown"} — ${p.venue.name} · ${p.programme.title}`,
      via,
      ...c,
      studioHref: `/studio/catalogue/performances/${p.id}`,
      manageHref: via === "DIRECT" ? `/studio/catalogue/performances/${p.id}` : `/studio/catalogue/programmes/${p.programmeId}`,
      publicHref: own.status === "VISIBLE" && !occasionArchived ? `/performances/${p.slug}` : null,
      detail: via === "VIA_PROGRAMME" ? "Reached through an attached programme" : null,
    });
  }
  for (const p of programmeFacts) {
    const own = classifyProgramme({ visible: visibleProgrammeIds.has(p.id), archived: p.archivedAt !== null, hasHeldRecording: heldProgrammeIds.has(p.id) });
    items.push({ kind: "PROGRAMME", id: p.id, label: p.title, via: "DIRECT", ...wrap(own), studioHref: `/studio/catalogue/programmes/${p.id}`, manageHref: `/studio/catalogue/programmes/${p.id}`, publicHref: own.status === "VISIBLE" && !occasionArchived ? `/programmes/${p.slug}` : null, detail: null });
  }
  for (const c0 of collectionFacts) {
    const own = classifyCollection({ visible: visibleCollectionIds.has(c0.id), published: c0.status === "PUBLISHED", archived: c0.archivedAt !== null });
    items.push({ kind: "COLLECTION", id: c0.id, label: c0.title, via: "DIRECT", ...wrap(own), studioHref: `/studio/catalogue/collections/${c0.id}`, manageHref: `/studio/catalogue/collections/${c0.id}`, publicHref: own.status === "VISIBLE" && !occasionArchived ? `/collections/${c0.slug}` : null, detail: `Status: ${c0.status.toLowerCase()}` });
  }
  for (const r of recordingRows) {
    const carriesPublished = publishedCarryIds.has(r.id);
    const carriesDraftOnly = draftCarry.has(r.id) && !pointerCarry.has(r.id);
    const carriesByPointer = pointerCarry.has(r.id);
    const olderOnly = linkedRecordingIds.has(r.id) && !carriesByPointer && !draftCarry.has(r.id) && !derivedIds.has(r.id);
    const via: ConnectionVia = carriesByPointer ? "PUBLISHED_REVISION" : carriesDraftOnly ? "DRAFT_REVISION_ONLY" : olderOnly ? "OLDER_REVISION_ONLY" : "VIA_PERFORMANCE";
    const published = isRecordingPubliclyVisible(r);
    // The page lists a Recording when it is published AND (its published revision carries the Occasion OR it records a listed Performance).
    const visible = published && (carriesPublished || derivedIds.has(r.id));
    const own = classifyRecording({ visible, via: carriesPublished ? "PUBLISHED_REVISION" : derivedIds.has(r.id) ? "VIA_PERFORMANCE" : via, recordingStatus: r.status, publishedRevisionCarries: carriesByPointer, draftRevisionCarries: draftCarry.has(r.id), onlyOlderRevisionCarries: olderOnly, held: r.holdReason !== null });
    items.push({
      kind: "RECORDING",
      id: r.id,
      label: r.currentPublishedRevision?.title ?? r.currentDraftRevision?.title ?? r.slug,
      via,
      ...wrap(own),
      studioHref: `/studio/recordings/${r.id}/review`,
      manageHref: via === "VIA_PERFORMANCE" ? null : `/studio/recordings/${r.id}/relationships`,
      publicHref: own.status === "VISIBLE" && !occasionArchived ? `/recordings/${r.slug}` : null,
      detail: `Status: ${r.status.toLowerCase().replace(/_/g, " ")}`,
    });
  }

  const connections = sortConnections(items);
  const visible = occasionArchived ? 0 : connections.filter((i) => i.status === "VISIBLE").length;
  const summary = summarisePublicPage({ occasionArchived, linked: connections.length, visible });
  const truncated = [performanceFacts, programmeFacts, collectionFacts, revisionLinks, derivedRevisions, recordingRows].some((list) => list.length >= LIST_LIMIT);

  return {
    occasion: { id: occasion.id, slug: occasion.slug, name: occasion.name, description: occasion.description, archivedAt: occasion.archivedAt, createdAt: occasion.createdAt, updatedAt: occasion.updatedAt },
    publicPage: { ...summary, href: summary.state === "PUBLIC" ? `/occasions/${occasion.slug}` : null },
    connections,
    counts: { linked: connections.length, visible },
    truncated,
  };
}
