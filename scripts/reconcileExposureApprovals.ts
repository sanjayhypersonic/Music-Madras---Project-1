// Operator script (Phase 6K fix F3): reconcile the recorded exposure approvals with the legacy approval flag.
//
//   npm run reconcile:exposure-approvals                                    DRY RUN: reads and reports what it WOULD do. Writes nothing.
//   npm run reconcile:exposure-approvals -- --execute --actor <email>       applies it, page by page, recording <email> in the audit log.
//   add --json for a machine-readable report;  add --confirm-restore-point when the target is not this machine (see below).
//
// What it does, and why, is in modules/mmke/catalogue/approvalReconciliation.ts and docs/runbooks/exposure-approvals-rollout.md. In short: where an
// earlier version of the software approved an unlisted page with the legacy flag only, the matching approval rows are added (clearly marked as carried
// over, and the page stays listed as it was); where it revoked with the flag only, the leftover approval rows are revoked. It is idempotent.
//
// Safety, by construction:
//  - It is NOT wired into deployment, application start-up, the YouTube sync, a Studio page or a scheduler. Only an operator runs it.
//  - It never reads DATABASE_URL / DIRECT_URL / a .env file as its target. The target is RECONCILE_DATABASE_URL, and the run refuses unless
//    RECONCILE_TARGET_CONFIRM equals the target's "host:port/database" exactly (typed by the operator, so a stale shell variable cannot aim it).
//  - --execute needs --actor <email> of an ACTIVE Studio user who may publish; and, for any target that is not loopback, --confirm-restore-point
//    (the operator asserts a database restore point exists).
//  - It makes no YouTube call and changes no YouTube setting.
// Exit codes: 0 done, 2 failed, 4 refused / configuration.

const EXIT = { OK: 0, FAILED: 2, REFUSED: 4 } as const;

function refuse(reason: string): never {
  console.error(`REFUSED: ${reason}`);
  process.exit(EXIT.REFUSED);
}

function describeTarget(rawUrl: string): { name: string; loopback: boolean } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    refuse("RECONCILE_DATABASE_URL is not a valid URL.");
  }
  const host = url.hostname.toLowerCase();
  const port = url.port || "5432";
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!host || !database) refuse("RECONCILE_DATABASE_URL must name a host and a database.");
  return { name: `${host}:${port}/${database}`.toLowerCase(), loopback: host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]" };
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const known = new Set(["--execute", "--json", "--help", "--actor", "--confirm-restore-point"]);
  const flags = args.filter((a) => a.startsWith("--"));
  const unknown = flags.filter((a) => !known.has(a));
  if (unknown.length > 0) refuse(`unknown argument(s): ${unknown.join(" ")}. Use --execute, --actor <email>, --json, --confirm-restore-point or --help.`);
  if (args.includes("--help")) {
    console.log("Usage: reconcile:exposure-approvals [--execute --actor <email>] [--json] [--confirm-restore-point]\nDry run by default. Needs RECONCILE_DATABASE_URL and RECONCILE_TARGET_CONFIRM=host:port/database; see docs/runbooks/exposure-approvals-rollout.md.");
    return EXIT.OK;
  }
  const execute = args.includes("--execute");
  const json = args.includes("--json");
  const actorIndex = args.indexOf("--actor");
  const actorEmail = actorIndex >= 0 ? args[actorIndex + 1] : undefined;

  const rawUrl = process.env.RECONCILE_DATABASE_URL;
  if (!rawUrl) refuse("RECONCILE_DATABASE_URL is not set. This script never falls back to DATABASE_URL.");
  const target = describeTarget(rawUrl);
  const confirm = (process.env.RECONCILE_TARGET_CONFIRM ?? "").trim().toLowerCase();
  if (confirm !== target.name) refuse(`RECONCILE_TARGET_CONFIRM must equal the target exactly (expected "${target.name}").`);
  if (execute && !actorEmail) refuse("--execute needs --actor <email> of a Studio user who may publish.");
  if (execute && !target.loopback && !args.includes("--confirm-restore-point")) refuse("this target is not on this machine: --execute also needs --confirm-restore-point (assert that a restore point exists).");
  if (!json) console.log(`Target: ${target.name}${target.loopback ? " (loopback)" : ""} — ${execute ? "EXECUTE" : "dry run"}`);

  // The application's database client reads DATABASE_URL when it is first imported, so it is set from the validated target BEFORE the import
  // (dotenv never overrides a variable that is already set, so the repository's .env cannot redirect it).
  process.env.DATABASE_URL = rawUrl;
  process.env.DIRECT_URL = rawUrl;
  const { prisma } = await import("../modules/db/client");
  const { applyApprovalReconciliation, planApprovalReconciliation } = await import("../modules/db/repositories/approvalReconciliationRepository");
  const { can } = await import("../modules/auth/policy");

  try {
    const plan = await planApprovalReconciliation();
    if (!execute) {
      if (json) console.log(JSON.stringify({ target: target.name, mode: "DRY RUN", ...plan }, null, 2));
      else {
        console.log(`Pages inspected: ${plan.pagesInspected}`);
        console.log(`Would add carried-over approvals (page + listing): ${plan.counts.addLegacyApprovals}`);
        console.log(`Would revoke approvals left behind by a flag-only revocation: ${plan.counts.revokeOrphanedApprovals}`);
        console.log(`Would clear a stale legacy flag (page archived, or video private): ${plan.counts.clearStaleFlags}`);
        console.log(`Blocked by a hold (nothing would be created): ${plan.counts.blockedByHold}`);
        for (const a of plan.actions) console.log(`  ${a.videoPageId}: ${a.decision.kind}`);
        console.log("\nDry run only: nothing was written. Re-run with --execute --actor <email> to apply.");
      }
      return EXIT.OK;
    }
    const actor = await prisma.studioUser.findUnique({ where: { email: String(actorEmail).toLowerCase() }, select: { id: true, status: true, role: true } });
    if (!actor || actor.status !== "ACTIVE" || !can(actor.role, "RECORDING_PUBLISH")) refuse("--actor must be an ACTIVE Studio user with the right to publish.");
    const result = await applyApprovalReconciliation({ actorId: actor.id });
    const after = await planApprovalReconciliation();
    if (json) console.log(JSON.stringify({ target: target.name, mode: "EXECUTE", ...result, remainingAfter: after.actions.length }, null, 2));
    else {
      console.log(`Added carried-over approvals: ${result.applied.addedLegacyApprovals}; revoked leftovers: ${result.applied.revokedApprovals}; cleared stale flags: ${result.applied.clearedStaleFlags}; skipped (hold): ${result.applied.skippedByHold}.`);
      console.log(`Actions still pending after the run (expected: only hold-blocked pages): ${after.actions.length}.`);
    }
    return EXIT.OK;
  } catch (error) {
    console.error(`FAILED: ${error instanceof Error ? error.message : "unknown error"}`);
    return EXIT.FAILED;
  } finally {
    await prisma.$disconnect();
  }
}

main().then((code) => process.exit(code));