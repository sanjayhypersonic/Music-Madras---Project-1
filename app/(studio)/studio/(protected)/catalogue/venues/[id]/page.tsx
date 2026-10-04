import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findVenueById } from "../../../../../../../modules/db/repositories/venueRepository";
import { findOrganisationById, listActiveOrganisations } from "../../../../../../../modules/db/repositories/organisationRepository";
import { getVenueRelatedContent } from "../../../../../../../modules/db/repositories/entityRelationshipsRepository";
import { archiveVenueAction, restoreVenueAction, updateVenueAction } from "./actions";
import type { VenueType } from "@prisma/client";
import { StatusBadge } from "../../../../../../../components/studio/StatusBadge";

const VENUE_TYPES: VenueType[] = ["CHURCH", "CATHEDRAL", "CONCERT_HALL", "STUDIO", "OUTDOOR"];

// Phase 6G-4E — the Venue editorial management view, mirroring the
// Composer detail page's shape (brief §2: "use Composer/MusicalWork as
// the implementation pattern"). No public /venues/[slug] route exists
// yet (explicitly out of scope this phase), so there is no "View public
// page" link here.

export default async function VenueDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  const { id } = await params;
  const { error } = await searchParams;

  const venue = await findVenueById(id);
  if (!venue) {
    notFound();
  }

  const canWrite = can(session.user.role, "CATALOGUE_WRITE");
  const organisations = await listActiveOrganisations();
  // The venue's current organisation may itself be archived — always
  // include it in the picker's options so saving the form without
  // changing it doesn't silently unlink it.
  const currentOrganisationStillActive = venue.organisationId ? organisations.some((o) => o.id === venue.organisationId) : true;
  const currentOrganisation = !currentOrganisationStillActive && venue.organisationId ? await findOrganisationById(venue.organisationId) : null;

  const related = await getVenueRelatedContent(venue.id);

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/venues">← Venues</Link>
      </p>
      <h1>{venue.name}</h1>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeURIComponent(error)}</p>}

      <p>
        Status: <strong><StatusBadge status={venue.archivedAt ? "Archived" : "Active"} /></strong>
        <br />
        Slug: <code>{venue.slug}</code>
        <br />
        Organisation: {venue.organisation ? venue.organisation.name : "— none —"}
      </p>

      <h2>Edit</h2>
      {canWrite ? (
        <form
          action={updateVenueAction.bind(null, venue.id)}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
        >
          <label>
            Name
            <input name="name" required defaultValue={venue.name} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Type
            <select name="type" required defaultValue={venue.type} style={{ display: "block", width: "100%" }}>
              {VENUE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label>
            Address
            <input name="address" defaultValue={venue.address ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            City
            <input name="city" defaultValue={venue.city ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Country
            <input name="country" defaultValue={venue.country ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Operated by
            <select name="organisationId" defaultValue={venue.organisationId ?? ""} style={{ display: "block", width: "100%" }}>
              <option value="">— none —</option>
              {currentOrganisation && <option value={currentOrganisation.id}>{currentOrganisation.name} (archived)</option>}
              {organisations.map((organisation) => (
                <option key={organisation.id} value={organisation.id}>
                  {organisation.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="studio-button--primary">Save</button>
        </form>
      ) : (
        <p>You do not have permission to edit this venue.</p>
      )}

      {canWrite && (
        <div style={{ marginTop: "1rem" }}>
          {!venue.archivedAt ? (
            <form action={archiveVenueAction.bind(null, venue.id)}>
              <button type="submit" className="studio-button--danger">Archive</button>
            </form>
          ) : (
            <form action={restoreVenueAction.bind(null, venue.id)}>
              <button type="submit">Restore</button>
            </form>
          )}
        </div>
      )}

      <h2>Relationships</h2>
      <p>
        <strong>Performances ({related.performances.length})</strong>
      </p>
      {related.performances.length > 0 ? (
        <ul>
          {related.performances.map((performance) => (
            <li key={performance.id}>
              {performance.performanceDate ? new Date(performance.performanceDate).toLocaleDateString() : "Date unknown"} —{" "}
              {performance.programme.title}
            </li>
          ))}
        </ul>
      ) : (
        <p className="studio-empty">No performances linked yet.</p>
      )}

      <p>
        <strong>Recordings ({related.recordings.length})</strong>
      </p>
      {related.recordings.length > 0 ? (
        <ul>
          {related.recordings.map((recording) => (
            <li key={recording.id}>{recording.currentPublishedRevision.title ?? "Untitled recording"}</li>
          ))}
        </ul>
      ) : (
        <p className="studio-empty">No published recordings yet.</p>
      )}

      <p>
        <strong>Public Music Madras Videos ({related.videos.length})</strong>
      </p>
      {related.videos.length > 0 ? (
        <ul>
          {related.videos.map((video) => (
            <li key={video.id}>
              <Link href={`/videos/${video.page.slug}`} target="_blank" rel="noopener noreferrer">
                {video.youtubeVideo.title ?? "Untitled video"}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="studio-empty">No publicly visible videos yet.</p>
      )}

      <p>
        <strong>Collections ({related.collections.length})</strong>
      </p>
      {related.collections.length > 0 ? (
        <ul>
          {related.collections.map((collection) => (
            <li key={collection.id}>{collection.title}</li>
          ))}
        </ul>
      ) : (
        <p>Not part of any published collection yet.</p>
      )}
    </div>
  );
}
