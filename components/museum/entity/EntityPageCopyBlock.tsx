import type { PipelineEntityKind } from "@prisma/client";
import { findPublishedEntityPageCopy } from "../../../modules/db/repositories/pipelineRepository";
import { serializeJsonLd } from "../../../modules/seo/serializeJsonLd";

// R-34: an entity page's APPROVED copy (EntityPageCopy, status PUBLISHED only): the answer-first summary, the key facts, and schema.org JSON-LD
// whose sameAs links come only from sources the owner accepted. Renders nothing when there is no approved copy, so existing pages look exactly
// as before until a bundle is approved.

interface KeyFact {
  label: string;
  value: string;
}

export async function EntityPageCopyBlock({ kind, entityId, schemaType, name, emitJsonLd = true }: { kind: PipelineEntityKind; entityId: string; schemaType: string; name: string; /** false on pages that already emit their own JSON-LD for this entity (no duplicate node). */ emitJsonLd?: boolean }) {
  const copy = await findPublishedEntityPageCopy(kind, entityId);
  if (!copy) return null;
  const raw: unknown[] = Array.isArray(copy.keyFacts) ? (copy.keyFacts as unknown[]) : [];
  const facts = raw.filter((f): f is KeyFact => typeof f === "object" && f !== null && typeof (f as KeyFact).label === "string" && typeof (f as KeyFact).value === "string");
  const jsonLd = { "@context": "https://schema.org", "@type": schemaType, name, description: copy.metaDescription, ...(copy.sameAs.length ? { sameAs: copy.sameAs } : {}) };
  return (
    <section className="museum-entity-summary" aria-label="Summary">
      <p>{copy.summary}</p>
      {facts.length > 0 && (
        <dl className="museum-key-facts">
          {facts.map((f, i) => (
            <div key={`${f.label}-${i}`}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {emitJsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />}
    </section>
  );
}
