import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import type { MusicalWork, Recording, SheetMusicRequest, SheetMusicRequestStatus } from "@prisma/client";

// Studio review queue for Sheet Music Requests (ADR §17, master brief's
// "Sheet Music Requests as an MVP capability"). The public-facing request
// form itself (a Server Action anyone can submit, no Studio auth) is a
// separate later concern — this repository is only the Studio side:
// reviewing and triaging what has been submitted. Requester PII
// (name/email) is real data here because Studio staff genuinely need it to
// fulfil a request; modules/analytics is the layer that must never see it
// (see docs/analytics-architecture.md).

export interface SheetMusicRequestWithContext extends SheetMusicRequest {
  musicalWork: MusicalWork | null;
  recording: Recording | null;
}

export function listSheetMusicRequests(): Promise<SheetMusicRequestWithContext[]> {
  return prisma.sheetMusicRequest.findMany({
    orderBy: { createdAt: "desc" },
    include: { musicalWork: true, recording: true },
  });
}

export function countSheetMusicRequestsByStatus(status: SheetMusicRequestStatus): Promise<number> {
  return prisma.sheetMusicRequest.count({ where: { status } });
}

export async function updateSheetMusicRequestStatus(
  requestId: string,
  status: SheetMusicRequestStatus,
  actorId: string
): Promise<SheetMusicRequest> {
  const before = await prisma.sheetMusicRequest.findUnique({ where: { id: requestId } });

  const updated = await prisma.sheetMusicRequest.update({
    where: { id: requestId },
    data: { status },
  });

  await writeAuditLog({
    actorId,
    action: "SHEET_MUSIC_REQUEST_STATUS_CHANGED",
    entityType: "SheetMusicRequest",
    entityId: requestId,
    beforeSnapshot: { status: before?.status },
    afterSnapshot: { status },
  });

  return updated;
}
