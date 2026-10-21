import type { Metadata } from "next";
import { after } from "next/server";
import { notFound } from "next/navigation";
import { getSiteOrigin } from "../../../../modules/config/siteOrigin";
import { serializeJsonLd } from "../../../../modules/seo/serializeJsonLd";
import { trackPublicPageView } from "../../../../modules/analytics/trackPublicPageView";
import { findPublishedPlaylistBySlug } from "../../../../modules/db/repositories/playlistPageRepository";
import { EditorialBlockBody } from "../../../../components/museum/EditorialBlockBody";
import { RecordingCard } from "../../../../components/museum/RecordingCard";
import { EntityBreadcrumbs } from "../../../../components/museum/entity/EntityBreadcrumbs";

// Phase 6K-4 — a public playlist page. It renders ONLY the published snapshot (never the draft) and only the members the shared exposure rule
// lets visitors see on THIS playlist (public videos; an unlisted video only with its recorded approval for this playlist). A page with no
// visible member answers 404, like any other page that is not public.

export const dynamic = "force-dynamic";

const SITE_ORIGIN = getSiteOrigin();

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const playlist = await findPublishedPlaylistBySlug(slug);
  if (!playlist) return {};
  const title = playlist.seoTitle ?? playlist.title;
  const description = playlist.seoDescription ?? playlist.summary ?? undefined;
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    alternates: { canonical: `/playlists/${playlist.slug}` },
    openGraph: { title, description, type: "website", images: playlist.members[0]?.video.thumbnailUrl ? [{ url: playlist.members[0].video.thumbnailUrl }] : undefined },
  };
}

export default async function PublicPlaylistPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const playlist = await findPublishedPlaylistBySlug(slug);
  if (!playlist) notFound();

  after(() => trackPublicPageView({ path: `/playlists/${playlist.slug}` }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: playlist.title,
    description: playlist.summary ?? undefined,
    url: `${SITE_ORIGIN}/playlists/${playlist.slug}`,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: playlist.members.length,
      itemListElement: playlist.members.map((member, index) => ({ "@type": "ListItem", position: index + 1, url: `${SITE_ORIGIN}/videos/${member.page.slug}` })),
    },
  };

  return (
    <article>
      <EntityBreadcrumbs items={[{ label: "Music Madras", href: "/" }, { label: "Playlists", href: "/playlists" }, { label: playlist.title }]} />
      <header className="museum-entity-header">
        <p className="museum-eyebrow">Playlist</p>
        <h1>{playlist.title}</h1>
        {playlist.summary && <p className="museum-entity-header__description">{playlist.summary}</p>}
      </header>

      {playlist.body && (
        <section className="museum-section" aria-label="About this playlist">
          <EditorialBlockBody body={playlist.body} headingOffset={1} />
        </section>
      )}

      <section className="museum-section" aria-labelledby="playlist-videos-heading">
        <h2 id="playlist-videos-heading">
          {playlist.members.length} {playlist.members.length === 1 ? "video" : "videos"}
        </h2>
        <ol className="museum-recording-grid">
          {playlist.members.map(({ page, video, note }) => (
            <li key={page.id}>
              <RecordingCard page={page} video={video} />
              {note && <p className="museum-meta">{note}</p>}
            </li>
          ))}
        </ol>
      </section>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
    </article>
  );
}
