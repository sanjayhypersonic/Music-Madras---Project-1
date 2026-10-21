import type { Metadata } from "next";
import Link from "next/link";
import { after } from "next/server";
import { getSiteOrigin } from "../../../modules/config/siteOrigin";
import { trackPublicPageView } from "../../../modules/analytics/trackPublicPageView";
import { getPublishedEditorialBlock } from "../../../modules/db/repositories/editorialContentRepository";
import { listPublishedPlaylistPages } from "../../../modules/db/repositories/playlistPageRepository";
import { EditorialBlockBody } from "../../../components/museum/EditorialBlockBody";
import { EntityBreadcrumbs } from "../../../components/museum/entity/EntityBreadcrumbs";
import { EntityEmptyState } from "../../../components/museum/entity/EntityEmptyState";

// Phase 6K-4 — the public index of playlist pages: every published page that has at least one video visitors may see. The introduction is an
// editorial block (published snapshot only).

export const dynamic = "force-dynamic";

const SITE_ORIGIN = getSiteOrigin();

export async function generateMetadata(): Promise<Metadata> {
  const intro = await getPublishedEditorialBlock("museum-playlists-intro");
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: "Playlists — Music Madras",
    ...(intro?.seoDescription ? { description: intro.seoDescription } : {}),
    alternates: { canonical: "/playlists" },
  };
}

export default async function PlaylistsPage() {
  const [intro, playlists] = await Promise.all([getPublishedEditorialBlock("museum-playlists-intro"), listPublishedPlaylistPages()]);
  after(() => trackPublicPageView({ path: "/playlists" }));

  return (
    <article>
      <EntityBreadcrumbs items={[{ label: "Music Madras", href: "/" }, { label: "Playlists" }]} />
      <header className="museum-entity-header">
        <p className="museum-eyebrow">Playlists</p>
        <h1>Playlists</h1>
        {intro && (
          <div className="museum-entity-header__description">
            <EditorialBlockBody body={intro.body} headingOffset={1} />
          </div>
        )}
      </header>

      {playlists.length === 0 ? (
        <EntityEmptyState>No playlists have been published yet.</EntityEmptyState>
      ) : (
        <ul className="museum-category-grid">
          {playlists.map((playlist) => (
            <li key={playlist.slug} className="museum-category-card">
              <Link href={`/playlists/${playlist.slug}`}>
                <h3>{playlist.title}</h3>
                {playlist.summary && <p>{playlist.summary}</p>}
                <p className="museum-meta">
                  {playlist.memberCount} {playlist.memberCount === 1 ? "video" : "videos"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
