import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { can } from "../../../../../modules/auth/policy";
import { listSheetMusicRequests } from "../../../../../modules/db/repositories/sheetMusicRequestRepository";
import { updateRequestStatusAction } from "./actions";
import type { SheetMusicRequestStatus } from "@prisma/client";

const STATUSES: SheetMusicRequestStatus[] = ["NEW", "IN_REVIEW", "FULFILLED", "DECLINED"];

export default async function SheetMusicPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { error } = await searchParams;

  const requests = await listSheetMusicRequests();
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  return (
    <div>
      <h1>Sheet Music Requests</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}
      {requests.length === 0 ? (
        <p>No requests yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Requester</th>
              <th style={{ textAlign: "left" }}>Work / Recording</th>
              <th style={{ textAlign: "left" }}>Intended use</th>
              <th style={{ textAlign: "left" }}>Status</th>
              {canWrite && <th style={{ textAlign: "left" }}>Update</th>}
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <td>
                  {request.requesterName} ({request.requesterEmail})
                </td>
                <td>{request.musicalWork?.title ?? request.recording?.slug ?? "—"}</td>
                <td>{request.intendedUse ?? "—"}</td>
                <td>{request.status}</td>
                {canWrite && (
                  <td>
                    <form action={updateRequestStatusAction.bind(null, request.id)} style={{ display: "flex", gap: "0.5rem" }}>
                      <select name="status" defaultValue={request.status}>
                        {STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                      <button type="submit">Save</button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
