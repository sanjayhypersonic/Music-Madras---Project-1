import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicLearningGuidePageData } from "../../../../modules/db/repositories/entityRelationshipsRepository";
import { deriveLearningGuideExcerpt } from "../../../../modules/mmke/learningGuide/deriveLearningGuideExcerpt";
import { toIso8601Duration } from "../../../../modules/mmke/catalogue/toIso8601Duration";
import { EntityBreadcrumbs } from "../../../../components/museum/entity/EntityBreadcrumbs";
import { EntityHeader } from "../../../../components/museum/entity/EntityHeader";
import { EntitySection } from "../../../../components/museum/entity/EntitySection";
import { EntityEmptyState } from "../../../../components/museum/entity/EntityEmptyState";
import type { LearningGuidePageData } from "../../../../modules/mmke/learningGuidePage/learningGuidePageContract";

// Phase 6G-17 — the public /learning/[slug] page. Built from
// getPublicLearningGuidePageData's own LearningGuide-rooted traversal
// (LearningGuide -> LearningGuideWork/LearningGuideRecording), never
// resolveRelatedContent (which is Performance-rooted and has no entry
// point for a LearningGuide as its own subject) — mirrors the public
// /collections/[slug] page's exact pattern. No Prisma import here.
// Renders only the guide's own stored contentMarkdown — never rewritten,
// summarized, or supplemented.

const SITE_ORIGIN = process.env.AUTH_URL ?? "http://localhost:3000";

function formatPerformanceDate(date: Date | null): string | null {
  return date ? date.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" }) : null;
}

/**
 * Splits on blank lines and strips a leading Markdown heading marker (e.g.
 * "# ") from each paragraph — a minimal, non-fabricating paragraph
 * structure, never a full Markdown renderer (none exists in this
 * project). The text itself is never reworded, only the literal "#"
 * syntax character is removed so it doesn't render to readers.
 */
function contentParagraphs(contentMarkdown: string): string[] {
  return contentMarkdown
    .split(/\n\s*\n/)
    .map((p) => p.trim().replace(/^#{1,6}\s+/, ""))
    .filter((p) => p.length > 0);
}

function buildDescription(guide: LearningGuidePageData): string {
  return (
    deriveLearningGuideExcerpt(guide.contentMarkdown) ??
    `${guide.title} — a Music Madras Learning Guide from the archive of Chennai's Western Classical Music heritage.`
  );
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const guide = await getPublicLearningGuidePageData(slug);
  if (!guide) return {};

  const title = `${guide.title} — Music Madras`;
  const description = buildDescription(guide);
  const canonicalPath = `/learning/${guide.slug}`;

  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: { title, description, url: canonicalPath, type: "article" },
  };
}

export default async function LearningGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = await getPublicLearningGuidePageData(slug);
  if (!guide) {
    notFound();
  }

  const subtitleParts: string[] = [];
  if (guide.difficultyLevel) subtitleParts.push(guide.difficultyLevel);
  if (guide.estimatedReadingTimeMinutes) subtitleParts.push(`${guide.estimatedReadingTimeMinutes} min read`);
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(" · ") : null;

  // Only real, stored fields ever appear here (brief §11: "do not invent
  // educational metadata") — no author, datePublished, publisher, or
  // audience, since none of that data exists on LearningGuide.
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LearningResource",
    name: guide.title,
    url: `${SITE_ORIGIN}/learning/${guide.slug}`,
    description: buildDescription(guide),
  };
  if (guide.difficultyLevel) jsonLd.educationalLevel = guide.difficultyLevel;
  if (guide.estimatedReadingTimeMinutes) jsonLd.timeRequired = toIso8601Duration(guide.estimatedReadingTimeMinutes * 60);
  const about = [
    ...guide.works.map((work) => ({ "@type": "MusicComposition", name: work.title })),
    ...guide.composers.map((composer) => ({ "@type": "Person", name: composer.name })),
  ];
  if (about.length > 0) jsonLd.about = about;

  return (
    <article>
      <EntityBreadcrumbs
        items={[{ label: "Music Madras", href: "/" }, { label: "Learning Guides", href: "/learning" }, { label: guide.title }]}
      />

      <EntityHeader eyebrow="Learning Guide" name={guide.title} subtitle={subtitle} description={null} />

      <EntitySection id="guide" heading="Guide">
        {guide.contentMarkdown ? (
          contentParagraphs(guide.contentMarkdown).map((paragraph, index) => (
            <p key={index} className="museum-prose">
              {paragraph}
            </p>
          ))
        ) : (
          <EntityEmptyState>No content has been added to this learning guide yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="works" heading="Musical Works">
        {guide.works.length > 0 ? (
          <ul className="museum-related-list">
            {guide.works.map((work) => (
              <li key={work.id}>
                <Link href={`/works/${work.slug}`}>{work.title}</Link> —{" "}
                <Link href={`/composers/${work.composer.slug}`}>{work.composer.name}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No musical works have been attached to this guide yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="recordings" heading="Recordings">
        {guide.recordings.length > 0 ? (
          <ul className="museum-related-list">
            {guide.recordings.map((recording) => {
              const dateLabel = formatPerformanceDate(recording.context.performance?.performanceDate ?? null);
              const participants = [...recording.context.conductors, ...recording.context.choirs, ...recording.context.artists];
              return (
                <li key={recording.id}>
                  <Link href={`/recordings/${recording.slug}`}>{recording.title ?? "Untitled recording"}</Link>
                  {recording.context.programme && (
                    <>
                      {" — "}
                      <Link href={`/programmes/${recording.context.programme.slug}`}>{recording.context.programme.title}</Link>
                    </>
                  )}
                  {recording.context.venue && (
                    <>
                      {" · "}
                      <Link href={`/venues/${recording.context.venue.slug}`}>{recording.context.venue.name}</Link>
                    </>
                  )}
                  {dateLabel && (
                    <>
                      {" · "}
                      {dateLabel}
                    </>
                  )}
                  {participants.length > 0 && (
                    <span className="museum-performance-participants">
                      {" · "}
                      {participants.map((person, index) => (
                        <span key={person.slug}>
                          {index > 0 && ", "}
                          {person.name}
                        </span>
                      ))}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EntityEmptyState>No recordings have been attached to this guide yet.</EntityEmptyState>
        )}
      </EntitySection>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </article>
  );
}
