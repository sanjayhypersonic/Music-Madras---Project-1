import type { Metadata } from "next";
import Link from "next/link";
import {
  ARCHIVE_PAGE_SIZE,
  searchArchiveAll,
  searchArtists,
  searchChoirs,
  searchComposers,
  searchConductors,
  searchOrganisations,
  searchPerformances,
  searchProgrammes,
  searchRecordings,
  searchVenues,
  searchWorks,
} from "../../../modules/db/repositories/archiveSearchRepository";
import type {
  ArchiveEntityType,
  ArchiveSearchPage,
  ArchiveSearchResult,
  ArchiveSearchResultArtist,
  ArchiveSearchResultChoir,
  ArchiveSearchResultComposer,
  ArchiveSearchResultConductor,
  ArchiveSearchResultOrganisation,
  ArchiveSearchResultPerformance,
  ArchiveSearchResultProgramme,
  ArchiveSearchResultRecording,
  ArchiveSearchResultVenue,
  ArchiveSearchResultWork,
} from "../../../modules/mmke/archiveSearch/archiveSearchContract";
import {
  ARCHIVE_TYPE_LABELS,
  buildArchiveHref,
  normalizeArchiveType,
  parseArchivePage,
} from "../../../modules/mmke/archiveSearch/archiveUrlState";
import { EntityBreadcrumbs } from "../../../components/museum/entity/EntityBreadcrumbs";
import { EntitySection } from "../../../components/museum/entity/EntitySection";
import { EntityEmptyState } from "../../../components/museum/entity/EntityEmptyState";

// Phase 6G-7 — the public /archive discovery + search page. Server-side,
// URL-addressable, no client-side-only state: every result shown here
// came from a bounded, database-side query in
// modules/db/repositories/archiveSearchRepository.ts, which itself reuses
// the exact same public-visibility rules every other public page already
// uses (archivedAt-null, isRecordingPublished). No Prisma import here.

const SITE_ORIGIN = process.env.AUTH_URL ?? "http://localhost:3000";

const TYPE_LABELS = ARCHIVE_TYPE_LABELS;

interface ArchiveSearchParams {
  q?: string;
  type?: string;
  page?: string;
}

function formatLifespan(composer: ArchiveSearchResultComposer): string | null {
  if (composer.bornDate && composer.diedDate) return `${composer.bornDate}–${composer.diedDate}`;
  if (composer.bornDate) return `b. ${composer.bornDate}`;
  if (composer.diedDate) return `d. ${composer.diedDate}`;
  return composer.era;
}

function excerpt(text: string | null, maxLength = 140): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength).trimEnd()}…` : trimmed;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<ArchiveSearchParams>;
}): Promise<Metadata> {
  const { q, type } = await searchParams;
  const hasSearchState = Boolean(q?.trim()) || Boolean(type?.trim());
  const title = "Archive — Music Madras";
  const description =
    "Explore the Music Madras archive of composers, musical works, programmes, performances, artists, choirs, conductors, recordings, venues, and organisations documenting Chennai's Western Classical Music heritage.";

  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    // Phase 6G-7 §16: the canonical archive destination is always the
    // bare /archive path — a query/filter/page state is a navigation
    // state, never a separate indexable URL.
    alternates: { canonical: "/archive" },
    robots: hasSearchState ? { index: false, follow: true } : { index: true, follow: true },
    openGraph: { title, description, url: "/archive", type: "website" },
  };
}

function ResultTypeBadge({ entityType }: { entityType: ArchiveEntityType }) {
  return <p className="museum-eyebrow">{TYPE_LABELS[entityType].replace(/s$/, "").toUpperCase()}</p>;
}

function ComposerResult({ result }: { result: ArchiveSearchResultComposer }) {
  const lifespan = formatLifespan(result);
  const bio = excerpt(result.biography);
  return (
    <li className="museum-category-card">
      <ResultTypeBadge entityType="composer" />
      <h3>
        <Link href={`/composers/${result.slug}`}>{result.name}</Link>
      </h3>
      {lifespan && <p className="museum-meta">{lifespan}</p>}
      {bio && <p>{bio}</p>}
    </li>
  );
}

function WorkResult({ result }: { result: ArchiveSearchResultWork }) {
  return (
    <li className="museum-category-card">
      <ResultTypeBadge entityType="work" />
      <h3>
        <Link href={`/works/${result.slug}`}>{result.title}</Link>
      </h3>
      <p className="museum-meta">
        <Link href={`/composers/${result.composerSlug}`}>{result.composerName}</Link>
        {result.catalogueNumber ? ` · ${result.catalogueNumber}` : ""}
      </p>
    </li>
  );
}

function RecordingResult({ result }: { result: ArchiveSearchResultRecording }) {
  return (
    <li className="museum-category-card">
      <ResultTypeBadge entityType="recording" />
      <h3>
        <Link href={`/recordings/${result.slug}`}>{result.title ?? "Untitled recording"}</Link>
      </h3>
      {(result.programmeTitle || result.venueName) && (
        <p className="museum-meta">{[result.programmeTitle, result.venueName].filter(Boolean).join(" — ")}</p>
      )}
    </li>
  );
}

function ProgrammeResult({ result }: { result: ArchiveSearchResultProgramme }) {
  const preview = result.workTitles.length > 0 ? result.workTitles.join(", ") : null;
  return (
    <li className="museum-category-card">
      <ResultTypeBadge entityType="programme" />
      <h3>
        <Link href={`/programmes/${result.slug}`}>{result.title}</Link>
      </h3>
      {preview && <p className="museum-meta">{preview}</p>}
    </li>
  );
}

function formatPerformanceDate(date: Date | null): string | null {
  return date ? date.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" }) : null;
}

function PerformanceResult({ result }: { result: ArchiveSearchResultPerformance }) {
  const dateLabel = formatPerformanceDate(result.performanceDate);
  return (
    <li className="museum-category-card">
      <ResultTypeBadge entityType="performance" />
      <h3>
        <Link href={`/performances/${result.slug}`}>
          {result.programmeTitle} at {result.venueName}
        </Link>
      </h3>
      {dateLabel && <p className="museum-meta">{dateLabel}</p>}
    </li>
  );
}

function ArtistResult({ result }: { result: ArchiveSearchResultArtist }) {
  const bio = excerpt(result.biography);
  return (
    <li className="museum-category-card">
      <ResultTypeBadge entityType="artist" />
      <h3>
        <Link href={`/artists/${result.slug}`}>{result.name}</Link>
      </h3>
      {result.instrument && <p className="museum-meta">{result.instrument}</p>}
      {bio && <p>{bio}</p>}
    </li>
  );
}

function ChoirResult({ result }: { result: ArchiveSearchResultChoir }) {
  const description = excerpt(result.description);
  return (
    <li className="museum-category-card">
      <ResultTypeBadge entityType="choir" />
      <h3>
        <Link href={`/choirs/${result.slug}`}>{result.name}</Link>
      </h3>
      {result.directorName && <p className="museum-meta">Directed by {result.directorName}</p>}
      {description && <p>{description}</p>}
    </li>
  );
}

function ConductorResult({ result }: { result: ArchiveSearchResultConductor }) {
  const bio = excerpt(result.biography);
  return (
    <li className="museum-category-card">
      <ResultTypeBadge entityType="conductor" />
      <h3>
        <Link href={`/conductors/${result.slug}`}>{result.name}</Link>
      </h3>
      {bio && <p>{bio}</p>}
    </li>
  );
}

function VenueResult({ result }: { result: ArchiveSearchResultVenue }) {
  const location = [result.city, result.country].filter(Boolean).join(", ");
  return (
    <li className="museum-category-card">
      <ResultTypeBadge entityType="venue" />
      <h3>
        <Link href={`/venues/${result.slug}`}>{result.name}</Link>
      </h3>
      <p className="museum-meta">
        {result.venueType}
        {location ? ` — ${location}` : ""}
      </p>
    </li>
  );
}

function OrganisationResult({ result }: { result: ArchiveSearchResultOrganisation }) {
  const description = excerpt(result.description);
  return (
    <li className="museum-category-card">
      <ResultTypeBadge entityType="organisation" />
      <h3>
        <Link href={`/organisations/${result.slug}`}>{result.name}</Link>
      </h3>
      {description && <p>{description}</p>}
    </li>
  );
}

function ResultCard({ result }: { result: ArchiveSearchResult }) {
  switch (result.entityType) {
    case "composer":
      return <ComposerResult result={result} />;
    case "work":
      return <WorkResult result={result} />;
    case "recording":
      return <RecordingResult result={result} />;
    case "programme":
      return <ProgrammeResult result={result} />;
    case "performance":
      return <PerformanceResult result={result} />;
    case "artist":
      return <ArtistResult result={result} />;
    case "choir":
      return <ChoirResult result={result} />;
    case "conductor":
      return <ConductorResult result={result} />;
    case "venue":
      return <VenueResult result={result} />;
    case "organisation":
      return <OrganisationResult result={result} />;
  }
}

function SearchForm({ query, type }: { query?: string; type: ArchiveEntityType | null }) {
  return (
    <form method="get" action="/archive" className="museum-search-form" role="search">
      <label htmlFor="archive-search-input" className="museum-visually-hidden">
        Search the archive
      </label>
      <input
        id="archive-search-input"
        className="museum-search-input"
        type="search"
        name="q"
        defaultValue={query ?? ""}
        placeholder="Search composers, works, artists, choirs, conductors, recordings, venues, organisations…"
      />
      {type && <input type="hidden" name="type" value={type} />}
      <button type="submit" className="museum-button">
        Search
      </button>
      {(query || type) && (
        <Link href="/archive" className="museum-button">
          Clear
        </Link>
      )}
    </form>
  );
}

function FilterPills({ query, activeType }: { query?: string; activeType: ArchiveEntityType | null }) {
  const options: { type: ArchiveEntityType | null; label: string }[] = [
    { type: null, label: "All" },
    { type: "composer", label: "Composers" },
    { type: "work", label: "Works" },
    { type: "recording", label: "Recordings" },
    { type: "programme", label: "Programmes" },
    { type: "performance", label: "Performances" },
    { type: "artist", label: "Artists" },
    { type: "choir", label: "Choirs" },
    { type: "conductor", label: "Conductors" },
    { type: "venue", label: "Venues" },
    { type: "organisation", label: "Organisations" },
  ];

  return (
    <ul className="museum-filter-pills">
      {options.map((option) => (
        <li key={option.label}>
          <Link
            href={buildArchiveHref({ q: query, type: option.type })}
            className={activeType === option.type ? "museum-filter-pill--active" : ""}
            aria-current={activeType === option.type ? "true" : undefined}
          >
            {option.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Pagination({
  query,
  type,
  pageResult,
}: {
  query?: string;
  type: ArchiveEntityType;
  pageResult: ArchiveSearchPage<ArchiveSearchResult>;
}) {
  const totalPages = Math.max(1, Math.ceil(pageResult.total / pageResult.pageSize));
  if (totalPages <= 1) return null;

  const { page } = pageResult;
  return (
    <nav className="museum-pagination" aria-label="Search results pages">
      {page > 1 ? (
        <Link href={buildArchiveHref({ q: query, type, page: page - 1 })} className="museum-button">
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="museum-pagination__status">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={buildArchiveHref({ q: query, type, page: page + 1 })} className="museum-button">
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

export default async function ArchivePage({ searchParams }: { searchParams: Promise<ArchiveSearchParams> }) {
  const { q, type: rawType, page: rawPage } = await searchParams;
  const query = q?.trim() || undefined;
  const { type, invalid } = normalizeArchiveType(rawType);
  const requestedPage = parseArchivePage(rawPage);

  const heading = query ? `Search results for "${query}"` : "Explore the MusicMadras Archive";

  return (
    <article>
      <EntityBreadcrumbs items={[{ label: "Music Madras", href: "/" }, { label: "Archive" }]} />

      <header className="museum-entity-header">
        <p className="museum-eyebrow">Archive</p>
        <h1>{heading}</h1>
        <p className="museum-entity-header__description">
          Search the MusicMadras collection of composers, musical works, programmes, performances, artists,
          choirs, conductors, recordings, the venues that hosted them, and the organisations that operate
          them — every result is drawn directly from the canonical archive, never from raw synchronization data.
        </p>
      </header>

      <EntitySection id="search" heading="Search &amp; Filter">
        <SearchForm query={query} type={type} />
        <FilterPills query={query} activeType={type} />

        {invalid && (
          <EntityEmptyState>
            {`Unknown archive category "${rawType}" — showing all supported categories instead.`}
          </EntityEmptyState>
        )}

        {type ? (
          <SingleTypeResults type={type} query={query} page={requestedPage} />
        ) : (
          <AllTypesResults query={query} />
        )}
      </EntitySection>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: "Music Madras Archive",
            description:
              "Explore the Music Madras archive of composers, musical works, programmes, performances, artists, choirs, conductors, recordings, and venues documenting Chennai's Western Classical Music heritage.",
            url: `${SITE_ORIGIN}/archive`,
          }),
        }}
      />
    </article>
  );
}

async function SingleTypeResults({ type, query, page }: { type: ArchiveEntityType; query?: string; page: number }) {
  const result = await fetchPageForType(type, query, page);

  if (result.total === 0) {
    return (
      <EntityEmptyState>
        {query
          ? `No results found for "${query}" in ${TYPE_LABELS[type]}. Try another search term or explore a different archive category.`
          : `No ${TYPE_LABELS[type].toLowerCase()} have been catalogued yet.`}
      </EntityEmptyState>
    );
  }

  return (
    <>
      <p className="museum-meta">
        {result.total} {result.total === 1 ? TYPE_LABELS[type].replace(/s$/, "") : TYPE_LABELS[type].toLowerCase()}
        {query ? ` matching "${query}"` : ""}
      </p>
      <ul className="museum-category-grid">
        {result.items.map((item) => (
          <ResultCard key={`${item.entityType}-${item.id}`} result={item} />
        ))}
      </ul>
      <Pagination query={query} type={type} pageResult={result} />
    </>
  );
}

async function AllTypesResults({ query }: { query?: string }) {
  const all = await searchArchiveAll(query);
  const groups: { type: ArchiveEntityType; page: ArchiveSearchPage<ArchiveSearchResult> }[] = [
    { type: "composer", page: all.composers },
    { type: "work", page: all.works },
    { type: "recording", page: all.recordings },
    { type: "programme", page: all.programmes },
    { type: "performance", page: all.performances },
    { type: "artist", page: all.artists },
    { type: "choir", page: all.choirs },
    { type: "conductor", page: all.conductors },
    { type: "venue", page: all.venues },
    { type: "organisation", page: all.organisations },
  ];

  const totalAcrossAllTypes = groups.reduce((sum, group) => sum + group.page.total, 0);

  if (totalAcrossAllTypes === 0) {
    return (
      <EntityEmptyState>
        {query
          ? `No results found for "${query}". Try another search term or explore a different archive category.`
          : "The archive is still being catalogued — check back soon."}
      </EntityEmptyState>
    );
  }

  return (
    <>
      {!query && <p className="museum-section__intro">Recently added to the archive, by category:</p>}
      {groups.map((group) =>
        group.page.total > 0 ? (
          <div key={group.type} style={{ marginBottom: "2rem" }}>
            <h3>{TYPE_LABELS[group.type]}</h3>
            <ul className="museum-category-grid">
              {group.page.items.map((item) => (
                <ResultCard key={`${item.entityType}-${item.id}`} result={item} />
              ))}
            </ul>
            {group.page.total > group.page.items.length && (
              <p>
                <Link href={buildArchiveHref({ q: query, type: group.type })}>
                  See all {group.page.total} results in {TYPE_LABELS[group.type]} →
                </Link>
              </p>
            )}
          </div>
        ) : null
      )}
    </>
  );
}

async function fetchPageForType(
  type: ArchiveEntityType,
  query: string | undefined,
  page: number
): Promise<ArchiveSearchPage<ArchiveSearchResult>> {
  switch (type) {
    case "composer":
      return searchComposers(query, page, ARCHIVE_PAGE_SIZE);
    case "work":
      return searchWorks(query, page, ARCHIVE_PAGE_SIZE);
    case "recording":
      return searchRecordings(query, page, ARCHIVE_PAGE_SIZE);
    case "programme":
      return searchProgrammes(query, page, ARCHIVE_PAGE_SIZE);
    case "performance":
      return searchPerformances(query, page, ARCHIVE_PAGE_SIZE);
    case "artist":
      return searchArtists(query, page, ARCHIVE_PAGE_SIZE);
    case "choir":
      return searchChoirs(query, page, ARCHIVE_PAGE_SIZE);
    case "conductor":
      return searchConductors(query, page, ARCHIVE_PAGE_SIZE);
    case "venue":
      return searchVenues(query, page, ARCHIVE_PAGE_SIZE);
    case "organisation":
      return searchOrganisations(query, page, ARCHIVE_PAGE_SIZE);
  }
}
