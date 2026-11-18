import Link from "next/link";
import type { PipelineEntityKind } from "@prisma/client";
import { EntityBreadcrumbs } from "./EntityBreadcrumbs";
import { EntityHeader } from "./EntityHeader";
import { EntitySection } from "./EntitySection";
import { EntityEmptyState } from "./EntityEmptyState";
import { EntityPageCopyBlock } from "./EntityPageCopyBlock";
import { RecordingCard } from "../RecordingCard";
import type { RelatedContent } from "../../../modules/db/repositories/entityRelationshipsRepository";
import { toVideo } from "../../../modules/mmke/entityPage/assembleEntityPageData";

// R-34: the shared body of the public person pages (/people, /arrangers, /lyricists) and ensemble pages (/ensembles): the approved summary and
// key facts, the person's roles (each linking to that role's own page), the works they arranged or wrote words for, and the published recordings
// and videos they are part of — all from the same visibility-filtered relationship graph as every other entity page.

const ROLE_WORD: Record<string, string> = { ARRANGER: "Arranged", LYRICIST: "Words", TRANSLATOR: "Translation" };

export function PersonOrEnsemblePage(props: {
  kind: PipelineEntityKind;
  eyebrow: string;
  section: string;
  id: string;
  name: string;
  description: string | null;
  roles?: Array<{ role: string; name: string; href: string }>;
  contributions?: Array<{ role: string; workTitle: string; workHref: string }>;
  related: RelatedContent;
}) {
  return (
    <article>
      <EntityBreadcrumbs items={[{ label: "Music Madras", href: "/" }, { label: "Archive", href: "/archive" }, { label: props.section }, { label: props.name }]} />
      <EntityHeader eyebrow={props.eyebrow} name={props.name} subtitle={null} description={props.description} />
      <EntityPageCopyBlock kind={props.kind} entityId={props.id} schemaType={props.kind === "ENSEMBLE" ? "MusicGroup" : "Person"} name={props.name} />

      {props.roles && props.roles.length > 0 && (
        <EntitySection id="roles" heading="Roles in the archive">
          <ul className="museum-related-list">
            {props.roles.map((r) => (
              <li key={r.href}>
                {r.role}: <Link href={r.href}>{r.name}</Link>
              </li>
            ))}
          </ul>
        </EntitySection>
      )}

      {props.contributions && props.contributions.length > 0 && (
        <EntitySection id="works" heading="Works">
          <ul className="museum-related-list">
            {props.contributions.map((c) => (
              <li key={`${c.role}-${c.workHref}`}>
                {ROLE_WORD[c.role] ?? c.role}: <Link href={c.workHref}>{c.workTitle}</Link>
              </li>
            ))}
          </ul>
        </EntitySection>
      )}

      <EntitySection id="recordings" heading="Recordings">
        {props.related.recordings.length > 0 ? (
          <ul className="museum-related-list">
            {props.related.recordings.map((recording) => (
              <li key={recording.id}>
                <Link href={`/recordings/${recording.slug}`}>{recording.currentPublishedRevision?.title ?? "Untitled recording"}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No recordings have been published yet.</EntityEmptyState>
        )}
      </EntitySection>

      {props.related.videos.length > 0 && (
        <EntitySection id="discover" heading="Music Madras Videos" intro="Recordings from the Music Madras archive.">
          <ul className="museum-recording-grid">
            {props.related.videos.map(toVideo).map((video) => (
              <li key={video.slug}>
                <RecordingCard page={{ slug: video.slug }} video={{ title: video.title, thumbnailUrl: video.thumbnailUrl }} />
              </li>
            ))}
          </ul>
        </EntitySection>
      )}
    </article>
  );
}
