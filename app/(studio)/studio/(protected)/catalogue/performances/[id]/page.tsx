import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isPlausibleSlug } from "../../../../../../../modules/mmke/slug/isPlausibleSlug";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findPerformanceById } from "../../../../../../../modules/db/repositories/performanceRepository";
import { listProgrammesForStudio } from "../../../../../../../modules/db/repositories/programmeRepository";
import { listVenuesForStudio } from "../../../../../../../modules/db/repositories/venueRepository";
import { listActiveArtists } from "../../../../../../../modules/db/repositories/artistRepository";
import { listActiveChoirs } from "../../../../../../../modules/db/repositories/choirRepository";
import { listActiveConductors } from "../../../../../../../modules/db/repositories/conductorRepository";
import { listActiveOccasions, listOccasionsForEntity } from "../../../../../../../modules/db/repositories/occasionRepository";
import { StatusBadge } from "../../../../../../../components/studio/StatusBadge";
import {
  addArtistAction,
  addChoirAction,
  addConductorAction,
  archivePerformanceAction,
  attachOccasionAction,
  detachOccasionAction,
  removeArtistAction,
  removeChoirAction,
  removeConductorAction,
  restorePerformanceAction,
  updatePerformanceAction,
} from "./actions";
import { decodeMessage } from "../../../../../../../modules/studio/decodeMessage";

// Phase 6G-4H — the Performance editorial management view. Distinct from
// the existing /studio/recordings/[id]/performance wizard step: that page
// only ever creates a brand-new Performance 1:1 with the current recording
// draft and is left completely unchanged; this page is for browsing/editing
// every Performance as a canonical catalogue record, with full
// Programme/Venue reassignment and participant management that the wizard
// step never exposed.

export default async function PerformanceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  const { id } = await params;
  // An id no row could have (a NUL byte, which PostgreSQL rejects as text, or an absurd length) is not found, not a database error. After the sign-in check, so a visitor who is not signed in is still sent to sign in.
  if (!isPlausibleSlug(id)) notFound();
  const { error } = await searchParams;

  const performance = await findPerformanceById(id);
  if (!performance) {
    notFound();
  }

  const canWrite = can(session.user.role, "CATALOGUE_WRITE");
  const [programmes, venues, artists, choirs, conductors, activeOccasions, attachedOccasions] = await Promise.all([
    listProgrammesForStudio(),
    listVenuesForStudio(),
    listActiveArtists(),
    listActiveChoirs(),
    listActiveConductors(),
    listActiveOccasions(),
    listOccasionsForEntity("PERFORMANCE", performance.id),
  ]);
  const attachableOccasions = activeOccasions.filter(
    (occasion) => !attachedOccasions.some((link) => link.occasionId === occasion.id)
  );

  const performanceDateValue = performance.performanceDate
    ? new Date(performance.performanceDate).toISOString().slice(0, 10)
    : "";

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/performances">← Performances</Link>
      </p>
      <h1>
        {performance.programme.title} at {performance.venue.name}
      </h1>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeMessage(error)}</p>}

      <p>
        Status: <strong><StatusBadge status={performance.archivedAt ? "Archived" : "Active"} /></strong>
        <br />
        Programme: <Link href={`/studio/catalogue/programmes/${performance.programme.id}`}>{performance.programme.title}</Link>
        <br />
        Venue: <Link href={`/studio/catalogue/venues/${performance.venue.id}`}>{performance.venue.name}</Link>
      </p>

      <h2>Edit</h2>
      {canWrite ? (
        <form
          action={updatePerformanceAction.bind(null, performance.id)}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
        >
          <label>
            Programme
            <select name="programmeId" required defaultValue={performance.programmeId} style={{ display: "block", width: "100%" }}>
              {programmes.map((programme) => (
                <option key={programme.id} value={programme.id}>
                  {programme.title}
                  {programme.archivedAt ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Venue
            <select name="venueId" required defaultValue={performance.venueId} style={{ display: "block", width: "100%" }}>
              {venues.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name}
                  {venue.archivedAt ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Performance date
            <input type="date" name="performanceDate" defaultValue={performanceDateValue} style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit" className="studio-button--primary">Save</button>
        </form>
      ) : (
        <p>You do not have permission to edit this performance.</p>
      )}

      {canWrite && (
        <div style={{ marginTop: "1rem" }}>
          {!performance.archivedAt ? (
            <form action={archivePerformanceAction.bind(null, performance.id)}>
              <button type="submit" className="studio-button--danger">Archive</button>
            </form>
          ) : (
            <form action={restorePerformanceAction.bind(null, performance.id)}>
              <button type="submit">Restore</button>
            </form>
          )}
        </div>
      )}

      <h2>Occasions ({attachedOccasions.length})</h2>
      {attachedOccasions.length === 0 ? (
        <p className="studio-empty">No occasions have been attached to this performance yet.</p>
      ) : (
        <ul>
          {attachedOccasions.map((link) => (
            <li key={link.occasionId}>
              {link.occasion.name}
              {link.occasion.archivedAt ? " (archived)" : ""}
              {canWrite && (
                <form action={detachOccasionAction.bind(null, performance.id, link.occasionId)} style={{ display: "inline" }}>
                  <button type="submit" className="studio-button--danger">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && attachableOccasions.length > 0 && (
        <form action={attachOccasionAction.bind(null, performance.id)} style={{ display: "flex", gap: "0.5rem", maxWidth: "28rem" }}>
          <select name="occasionId" required style={{ flex: 1 }}>
            {attachableOccasions.map((occasion) => (
              <option key={occasion.id} value={occasion.id}>
                {occasion.name}
              </option>
            ))}
          </select>
          <button type="submit" className="studio-button--primary">Attach occasion</button>
        </form>
      )}

      <h2>Artists ({performance.performers.length})</h2>
      {performance.performers.length === 0 ? (
        <p className="studio-empty">No artists have been added to this performance yet.</p>
      ) : (
        <ul>
          {performance.performers.map((link) => (
            <li key={link.artistId}>
              {link.artist.name}
              {link.role ? ` — ${link.role}` : ""}
              {canWrite && (
                <form action={removeArtistAction.bind(null, performance.id, link.artistId)} style={{ display: "inline" }}>
                  <button type="submit" className="studio-button--danger">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form
          action={addArtistAction.bind(null, performance.id)}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
        >
          <label>
            Artist
            <select name="artistId" required style={{ display: "block", width: "100%" }}>
              {artists.map((artist) => (
                <option key={artist.id} value={artist.id}>
                  {artist.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Role (optional)
            <input name="role" placeholder="e.g. Soloist" style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit" className="studio-button--primary">Add artist</button>
        </form>
      )}

      <h2>Choirs ({performance.choirs.length})</h2>
      {performance.choirs.length === 0 ? (
        <p className="studio-empty">No choirs have been added to this performance yet.</p>
      ) : (
        <ul>
          {performance.choirs.map((link) => (
            <li key={link.choirId}>
              {link.choir.name}
              {canWrite && (
                <form action={removeChoirAction.bind(null, performance.id, link.choirId)} style={{ display: "inline" }}>
                  <button type="submit" className="studio-button--danger">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form action={addChoirAction.bind(null, performance.id)} style={{ display: "flex", gap: "0.5rem", maxWidth: "28rem" }}>
          <select name="choirId" required style={{ flex: 1 }}>
            {choirs.map((choir) => (
              <option key={choir.id} value={choir.id}>
                {choir.name}
              </option>
            ))}
          </select>
          <button type="submit" className="studio-button--primary">Add choir</button>
        </form>
      )}

      <h2>Conductors ({performance.conductors.length})</h2>
      {performance.conductors.length === 0 ? (
        <p className="studio-empty">No conductors have been added to this performance yet.</p>
      ) : (
        <ul>
          {performance.conductors.map((link) => (
            <li key={link.conductorId}>
              {link.conductor.name}
              {canWrite && (
                <form action={removeConductorAction.bind(null, performance.id, link.conductorId)} style={{ display: "inline" }}>
                  <button type="submit" className="studio-button--danger">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form action={addConductorAction.bind(null, performance.id)} style={{ display: "flex", gap: "0.5rem", maxWidth: "28rem" }}>
          <select name="conductorId" required style={{ flex: 1 }}>
            {conductors.map((conductor) => (
              <option key={conductor.id} value={conductor.id}>
                {conductor.name}
              </option>
            ))}
          </select>
          <button type="submit" className="studio-button--primary">Add conductor</button>
        </form>
      )}
    </div>
  );
}
