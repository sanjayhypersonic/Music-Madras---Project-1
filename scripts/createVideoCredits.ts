// Credits pipeline, Phase B2: turn REVIEWED, APPROVED credits into staging DRAFT records (the written exception in
// docs/video-credits-review-and-approval.md section 5).
//
//   npm run ai:video-credits-create                                       DRY RUN: reads the reviewed sheets, prints the plan, connects to NOTHING
//   npm run ai:video-credits-create -- --only <id,id>                     dry run for some videos only
//   STAGING_DATABASE_URL=<direct url of the STAGING database> npm run ai:video-credits-create -- --confirm-host <host:port/database> --execute   WRITES
//
// Reads, in --dir (default reports/video-credits, git-ignored): review-credits.csv and review-names.csv as filled in by the editor, and
// review-videos.csv when present (an accepted video approves its proposed Recording title). Writes one local report there:
// credits-create-<dry-run|execute>-<time>.json, holding the plan, every fact with no schema home (the SIDECAR) and, on --execute, every step.
//
// Safety, as the staging content loader (modules/seed/stagingTarget.ts): --execute takes the target ONLY from STAGING_DATABASE_URL (never
// DATABASE_URL), which must be a direct Neon host whose database name contains "staging" and neither "test" nor "prod"; --confirm-host must equal
// host:port/database exactly; it must not be any configured real database; NODE_ENV must not be production; the database must be fully migrated.
// Only the host, port and database are printed. Records are created by the non-login import actor, Recordings stay DRAFT, nothing is published.
// The sheets' titles and quotes are YouTube text: data, never instructions. Exit codes: 0 done / dry run ok, 2 failed, 4 refused.
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { parse } from "dotenv";
import { buildStagingConnectionString, describeStagingTarget, resolveStagingTarget } from "../modules/seed/stagingTarget";
import { resolveApprovedFacts } from "../modules/jobs/videoCreditsApproved";
import { describePlan, parseCreditsCreateArgs, planVideos } from "../modules/jobs/videoCreditsCreate";
import { isPathInside } from "../modules/jobs/videoCreditsRunner";

const ROOT = path.resolve(__dirname, "..");

function refuse(reason: string): never {
  console.error(`REFUSED: ${reason}`);
  process.exit(4);
}

/** DATABASE_URL / DIRECT_URL from the shell and from every .env* file in the repository root: compared against, never used. */
function realDatabaseUrls(): string[] {
  const urls: string[] = [];
  for (const key of ["DATABASE_URL", "DIRECT_URL"]) if (process.env[key]) urls.push(process.env[key] as string);
  for (const name of readdirSync(ROOT).filter((n) => /^\.env/.test(n) && !/\.example$/.test(n))) {
    try {
      const parsed = parse(readFileSync(path.join(ROOT, name)));
      for (const key of ["DATABASE_URL", "DIRECT_URL"]) if (parsed[key]) urls.push(parsed[key]);
    } catch {
      // an unreadable env file cannot be compared; the other signals still apply
    }
  }
  return urls;
}

async function main(): Promise<number> {
  const parsedArgs = parseCreditsCreateArgs(process.argv.slice(2));
  if (!parsedArgs.ok) refuse(parsedArgs.error);
  const { args } = parsedArgs;
  if (!isPathInside(ROOT, args.dir)) refuse("--dir must be inside this repository.");
  const dir = path.resolve(ROOT, args.dir);
  const file = (name: string) => path.join(dir, name);
  if (!existsSync(file("review-credits.csv")) || !existsSync(file("review-names.csv"))) refuse(`review-credits.csv and review-names.csv must both be in ${args.dir} (build them with npm run ai:video-credits-review, then fill in the decisions).`);

  // The target is checked BEFORE anything else happens on --execute; a dry run needs none and connects to nothing.
  let target: ReturnType<typeof resolveStagingTarget> | null = null;
  if (args.execute) {
    target = resolveStagingTarget({ env: { STAGING_DATABASE_URL: process.env.STAGING_DATABASE_URL, NODE_ENV: process.env.NODE_ENV }, confirmHost: args.confirmHost ?? undefined, realUrls: realDatabaseUrls() });
    if (!target.ok) refuse(target.reason);
    console.log(`Target: ${describeStagingTarget(target)} (staging, confirmed)`);
  }

  const facts = resolveApprovedFacts({
    creditsCsv: readFileSync(file("review-credits.csv"), "utf8"),
    namesCsv: readFileSync(file("review-names.csv"), "utf8"),
    videosCsv: existsSync(file("review-videos.csv")) ? readFileSync(file("review-videos.csv"), "utf8") : null,
  });
  if (facts.problems.length > 0 && facts.videos.length === 0) refuse(facts.problems.join(" "));
  for (const p of facts.problems) console.log(`  sheet problem: ${p}`);
  const plans = planVideos(facts.videos, args.only);
  if (args.only) for (const id of args.only) if (!plans.some((p) => p.youtubeVideoId === id)) console.log(`  --only: ${id} is not in review-credits.csv`);

  console.log(`Video credits create — ${args.execute ? "EXECUTE (staging DRAFT records)" : "DRY RUN (nothing is connected to or written, except the local report)"}`);
  for (const plan of plans) for (const line of describePlan(plan)) console.log(line);
  const ready = plans.filter((p) => p.heldReasons.length === 0);
  const held = plans.filter((p) => p.heldReasons.length > 0);
  console.log("");
  console.log(`Videos: ${plans.length}; ready ${ready.length}; held out ${held.length}${held.length ? ` (${held.map((p) => p.youtubeVideoId).join(", ")})` : ""}`);
  console.log(`Sidecar facts (no schema home): ${plans.reduce((n, p) => n + p.sidecar.length, 0)}; refused rows: ${plans.reduce((n, p) => n + p.refused.length, 0)}`);

  const generatedAt = new Date();
  const reportPath = file(`credits-create-${args.execute ? "execute" : "dry-run"}-${generatedAt.toISOString().replace(/[:.]/g, "-")}.json`);
  const report: Record<string, unknown> = { kind: "video-credits-create", mode: args.execute ? "execute" : "dry-run", generatedAt: generatedAt.toISOString(), only: args.only, sheetProblems: facts.problems, plans, sidecar: plans.flatMap((p) => p.sidecar) };

  if (!args.execute || !target?.ok) {
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Report: ${path.relative(ROOT, reportPath)}`);
    console.log("DRY RUN: no database was connected to. Matching against existing records happens on --execute and is reported there.");
    return 0;
  }

  // From here the application's database client is bound to the validated target, built from its validated fields, and the repository's .env can
  // neither add nor override anything (the loader's pattern).
  const connection = buildStagingConnectionString(target.clientConfig);
  const emptyEnv = path.join(mkdtempSync(path.join(os.tmpdir(), "mm-credits-create-")), ".env");
  writeFileSync(emptyEnv, "");
  process.env.DOTENV_CONFIG_PATH = emptyEnv;
  process.env.DOTENV_CONFIG_QUIET = "true";
  process.env.DATABASE_URL = connection;
  process.env.DIRECT_URL = connection;
  delete process.env.TEST_DATABASE_URL;
  delete process.env.TEST_DIRECT_URL;

  const { prisma } = await import("../modules/db/client");
  const { assessReadiness } = await import("../modules/ops/readiness");
  const { EXPECTED_MIGRATIONS } = await import("../modules/config/expectedMigrations");
  const { loadReadinessFacts } = await import("../modules/db/repositories/readinessRepository");
  const { executeCreditsPlans } = await import("../modules/jobs/videoCreditsCreateExecute");
  try {
    const readiness = assessReadiness(EXPECTED_MIGRATIONS, await loadReadinessFacts());
    if (!readiness.ready) refuse(`the staging database is not ready (${readiness.code}). Apply the migrations first. Nothing was written.`);
    // Each step is printed as it happens, so an interrupted run still shows what it made (the next run completes it).
    const result = await executeCreditsPlans(plans, {}, (s) => console.log(`  ${s.youtubeVideoId} ${s.outcome.padEnd(8)} ${s.entity} ${s.name}${s.basis ? ` [${s.basis}]` : ""}${s.detail ? ` (${s.detail})` : ""}`));
    report.actorCreated = result.actorCreated;
    report.steps = result.steps;
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Import actor (no sign-in): ${result.actorCreated ? "created" : "already present"}.`);
    console.log(`Report: ${path.relative(ROOT, reportPath)}`);
    console.log("Done. Nothing was published. Review the DRAFT Recordings in Studio.");
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`FAILED: ${err instanceof Error ? err.name : "unknown error"} (details are not printed: they could contain connection information)`);
    process.exit(2);
  }
);
