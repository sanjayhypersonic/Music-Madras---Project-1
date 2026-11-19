// R-34 manual mode: the staging connection for pipeline:entities, pipeline:packet and pipeline:import. The same guard as every pipeline operator
// script (scripts/lib/stagingClient.ts): STAGING_DATABASE_URL only, a direct Neon host with "staging" in the database name, --confirm-host typed
// exactly, never a configured real database. The client is imported only AFTER the target is bound.
import { bindStagingTarget } from "./stagingClient";

export type ManualRepo = typeof import("../../modules/db/repositories/pipelineRepository");

export async function connectStaging(confirmHost: string): Promise<{ ok: true; described: string; repo: ManualRepo; disconnect: () => Promise<void> } | { ok: false; reason: string }> {
  const bound = bindStagingTarget(confirmHost);
  if (!bound.ok) return bound;
  const repo = await import("../../modules/db/repositories/pipelineRepository");
  const { prisma } = await import("../../modules/db/client");
  return { ok: true, described: bound.described, repo, disconnect: () => prisma.$disconnect() };
}

/** Read only: the entity keys with approved (ACCEPTED) claims on staging. */
export async function readApprovedKeys(confirmHost: string): Promise<{ ok: true; described: string; keys: Set<string> } | { ok: false; reason: string }> {
  const c = await connectStaging(confirmHost);
  if (!c.ok) return c;
  try {
    return { ok: true, described: c.described, keys: await c.repo.listApprovedEntityKeys() };
  } finally {
    await c.disconnect();
  }
}
