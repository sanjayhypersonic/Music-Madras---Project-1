// R-34 item 8: reconcile the staging content loader's Dingiri Dingalae records with the editor's decision: the Work's title of record becomes
// டிங்கிரி டிங்காலே, "Dingiri Dingalae" is kept as an alternate title, and the composer becomes Vedha (modules/pipeline/reconcile.ts).
//
//   npm run pipeline:reconcile-staging                                                          DRY RUN, offline: prints the decision
//   STAGING_DATABASE_URL=<direct staging url> npm run pipeline:reconcile-staging -- --confirm-host <host:port/database>            DRY RUN against
//        staging: reads the Work and prints exactly what would change (read-only)
//   ... --confirm-host <host:port/database> --execute                                           WRITES (staging only), through updateMusicalWork,
//        changeMusicalWorkComposer and createComposer, as the non-login import actor; audited; the slug never changes
// A Work shown by a published Recording is refused. Exit codes: 0 done / dry run, 2 failed, 4 refused.
import { DINGIRI_DINGALAE_RECONCILIATION, describeReconcileAction, planWorkReconciliation } from "../modules/pipeline/reconcile";
import { bindStagingTarget, flag } from "./lib/stagingClient";

const args = process.argv.slice(2);

async function main(): Promise<number> {
  const target = DINGIRI_DINGALAE_RECONCILIATION;
  console.log(`Reconcile Work "${target.workSlug}": title "${target.title}", add alternate title(s) ${target.addAlternateTitles.map((t) => `"${t}"`).join(", ")}, composer "${target.composerName}".`);
  const confirmHost = flag(args, "--confirm-host");
  if (!confirmHost) {
    console.log("DRY RUN (offline): no database was named, so the current state was not read. Add --confirm-host with STAGING_DATABASE_URL to see the exact changes.");
    return args.includes("--execute") ? 4 : 0;
  }
  const bound = bindStagingTarget(confirmHost);
  if (!bound.ok) {
    console.error(`REFUSED: ${bound.reason}`);
    return 4;
  }
  console.log(`Target: ${bound.described} (staging, confirmed)`);
  const { prisma } = await import("../modules/db/client");
  const { PUBLISHED_REVISION_WHERE } = await import("../modules/db/repositories/publicEligibility");
  const { listActiveComposers, createComposer } = await import("../modules/db/repositories/composerRepository");
  const { updateMusicalWork, changeMusicalWorkComposer } = await import("../modules/db/repositories/musicalWorkRepository");
  const { ensureImportActor } = await import("../modules/db/repositories/stagingSeedRepository");
  const { resolveCanonicalSlug } = await import("../modules/mmke/slug/canonicalSlug");
  const { findExactNormalizedDuplicate } = await import("../modules/mmke/duplicate-detection/detectDuplicateName");
  try {
    const work = await prisma.musicalWork.findUnique({ where: { slug: target.workSlug }, include: { composer: { select: { name: true } } } });
    const inPublished = work ? (await prisma.recordingRevisionWork.count({ where: { musicalWorkId: work.id, revision: PUBLISHED_REVISION_WHERE } })) > 0 : false;
    const composers = await listActiveComposers();
    const state = work ? { id: work.id, slug: work.slug, title: work.title, alternateTitles: work.alternateTitles, composerId: work.composerId, composerName: work.composer.name, inPublishedContent: inPublished } : null;
    const actions = planWorkReconciliation(target, state, composers);
    for (const a of actions) console.log(`  ${describeReconcileAction(a)}`);
    if (actions.some((a) => a.kind === "REFUSE")) return 4;
    if (!args.includes("--execute") || actions[0].kind === "NOTHING_TO_DO") {
      console.log(args.includes("--execute") ? "Nothing to do." : "DRY RUN: read only, nothing was written. Add --execute to apply.");
      return 0;
    }
    const actor = await ensureImportActor();
    const set = actions.find((a) => a.kind === "SET_TITLE");
    const add = actions.find((a) => a.kind === "ADD_ALTERNATE_TITLES");
    if (set || add) {
      await updateMusicalWork(state!.id, { ...(set && set.kind === "SET_TITLE" ? { title: set.to } : {}), ...(add && add.kind === "ADD_ALTERNATE_TITLES" ? { alternateTitles: [...state!.alternateTitles, ...add.titles] } : {}), actorId: actor.id });
      console.log("  Work updated (slug unchanged).");
    }
    const composerAction = actions.find((a) => a.kind === "SET_COMPOSER");
    if (composerAction && composerAction.kind === "SET_COMPOSER") {
      const match = findExactNormalizedDuplicate(target.composerName, composers.map((c) => c.name));
      const composer = match
        ? composers.find((c) => c.name === match)!
        : await createComposer({ slug: await resolveCanonicalSlug({ title: target.composerName, fallback: "composer" }, async (s) => (await prisma.composer.findUnique({ where: { slug: s }, select: { id: true } })) !== null), name: target.composerName, actorId: actor.id });
      await changeMusicalWorkComposer(state!.id, composer.id, actor.id);
      const previousStillUsed = await prisma.musicalWork.count({ where: { composerId: state!.composerId } });
      console.log(`  Composer set to ${composer.name}. The previous composer "${state!.composerName}" is ${previousStillUsed > 0 ? "still used by other works" : "now unused (left in place; archive it in Studio if it was only a placeholder)"}.`);
    }
    console.log("Done. Nothing was published.");
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`FAILED: ${err instanceof Error ? err.name : "unknown error"}`);
    process.exit(2);
  }
);
