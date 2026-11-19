// Upload-to-draft pipeline (R-34), MANUAL ENTITY-FIRST mode: ENTITY CLAIMS in bundles. Pure.
//
// An entity-first claim (PipelineClaim with no pipelineVideoId, subjectKey = the entity key "<KIND>:<normalised name>") belongs to the entity and
// is researched once. Each bundle that names the entity sees it, numbered after the video's own claims (R<n>):
//   - it is attached to the bundle's resolved entity of the same kind and exact normalised name (after approved aliases); the video's single work
//     is the "VIDEO" subject, as in the API route;
//   - its relation to THIS video is computed here (relationToVideo): a PROPOSED claim the video contradicts is a CONFLICT in this bundle and needs
//     the owner's explicit decision; an ACCEPTED one the video contradicts is flagged and never stated on this video's page;
//   - rejected and stale claims are not attached.
// Deciding a claim in any bundle decides it for the entity (the claim is shared).

import type { CheckedVideoCredits } from "../ai/structuredOutput/validateVideoCreditsOutput";
import type { SourceTier } from "../mmke/guardrails/sources";
import type { DraftClaim } from "./drafts";
import { entityKeyOf } from "./entities";
import { relationToVideo } from "./research";
import type { EntityKind, Resolution } from "./resolve";

export interface StoredEntityClaim {
  dbId: string;
  /** The entity key ("COMPOSER:vedha"). */
  entityKey: string;
  entityKind: EntityKind;
  entityName: string;
  subjectKind: string;
  workTitle: string | null;
  value: string | null;
  statement: string;
  excerpt: string;
  sourceUrl: string;
  sourceTitle: string | null;
  sourceTier: SourceTier;
  status: "PROPOSED" | "ACCEPTED" | "CONFLICT" | "REJECTED" | "STALE";
  provenance: string;
}

/** The entity keys a bundle can draw entity-first claims from. */
export const bundleEntityKeys = (resolution: Resolution): string[] => [...new Set(resolution.entities.map((e) => entityKeyOf(e.kind, e.canonicalName)))];

export function attachEntityClaims(input: {
  videoClaims: readonly DraftClaim[];
  entityClaims: readonly StoredEntityClaim[];
  resolution: Resolution;
  video: { title: string | null; description: string | null };
  checked: CheckedVideoCredits | null;
}): DraftClaim[] {
  const works = input.resolution.entities.filter((e) => e.kind === "WORK");
  const out: DraftClaim[] = [...input.videoClaims];
  let n = input.videoClaims.length;
  for (const c of input.entityClaims) {
    if (c.status === "REJECTED" || c.status === "STALE") continue;
    const entity = input.resolution.entities.find((e) => entityKeyOf(e.kind, e.canonicalName) === c.entityKey);
    if (!entity) continue;
    const subjectKey = entity.kind === "WORK" && works.length === 1 ? "VIDEO" : entity.key;
    const relation = relationToVideo(c.subjectKind, c.workTitle, c.value, input.video, input.checked);
    const status = c.status === "PROPOSED" && relation === "CONFLICTS" ? "CONFLICT" : c.status;
    out.push({
      id: `R${++n}`,
      dbId: c.dbId,
      subjectKey,
      subjectKind: c.subjectKind,
      value: c.value,
      statement: c.statement,
      excerpt: c.excerpt,
      sourceUrl: c.sourceUrl,
      sourceTitle: c.sourceTitle,
      sourceTier: c.sourceTier,
      videoRelation: relation,
      status,
      entityLevel: true,
      provenance: c.provenance,
    });
  }
  return out;
}
