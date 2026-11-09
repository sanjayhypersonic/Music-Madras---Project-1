// Operator script: load the first curated content into the Neon STAGING database.
//
//   STAGING_DATABASE_URL=<direct url of the STAGING database> npm run seed:staging-content -- --confirm-host <host:port/database> --mirror <existing|fixtures>            DRY RUN
//   STAGING_DATABASE_URL=<direct url of the STAGING database> npm run seed:staging-content -- --confirm-host <host:port/database> --mirror <existing|fixtures> --execute  WRITES
//
// --mirror is REQUIRED and has no default, so the YouTube mirror is always a conscious choice:
//   existing  the mirror was filled by the documented full sync (npm run youtube:full-sync, run against the same staging database first). Nothing is imported; the
//             Recording's video must be there, public and OBSERVED. Keeps the sync engine's ownership baselines, checkpoints and observability history. PREFERRED.
//   fixtures  key-less bootstrap: inserts the five exported videos and two playlists (a snapshot, not an observation; a later full sync overwrites them with live values).
//
// DRY RUN (the default) validates the target, the curated content and every quoted fact, prints the target's identity and what would be loaded, and CONNECTS TO
// NOTHING. --execute additionally connects, requires the database to be fully migrated, and loads. The loader is idempotent: a repeat creates nothing twice and never
// changes a row that already exists.
//
// Safety (modules/seed/stagingTarget.ts): the target comes ONLY from STAGING_DATABASE_URL (never DATABASE_URL or any fallback); it must be a direct Neon host with
// "staging" in the database name and neither "test" nor "prod"; --confirm-host must equal host:port/database exactly; it must not be any configured real database
// (DATABASE_URL / DIRECT_URL in the shell or a .env* file); NODE_ENV must not be production. Only the host, port and database are ever printed.
// Exit codes: 0 done / dry run ok, 2 failed, 4 refused.
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { parse } from "dotenv";
import { buildStagingConnectionString, describeStagingTarget, resolveStagingTarget } from "../modules/seed/stagingTarget";
import { parseStagingContentSpec, verifyEvidence } from "../modules/seed/stagingContentSpec";

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

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
  const execute = args.includes("--execute");

  const target = resolveStagingTarget({ env: { STAGING_DATABASE_URL: process.env.STAGING_DATABASE_URL, NODE_ENV: process.env.NODE_ENV }, confirmHost: flag("--confirm-host"), realUrls: realDatabaseUrls() });
  if (!target.ok) refuse(target.reason);
  console.log(`Target: ${describeStagingTarget(target)} (staging, confirmed)`);
  const mirrorMode = flag("--mirror");
  if (mirrorMode !== "existing" && mirrorMode !== "fixtures") refuse("--mirror is required and must be `existing` (the mirror was filled by the full YouTube sync; preferred) or `fixtures` (insert the five exported videos and two playlists).");

  const contentFile = path.resolve(ROOT, flag("--content") ?? "content/staging/first-recording.json");
  const fixturesFile = path.resolve(ROOT, flag("--fixtures") ?? "tests/fixtures/realYouTubeVideos.json");
  if (!existsSync(contentFile) || !existsSync(fixturesFile)) refuse("the content file or the fixtures file does not exist.");
  const parsed = parseStagingContentSpec(JSON.parse(readFileSync(contentFile, "utf8")));
  if (!parsed.ok) refuse(`the content file is invalid: ${parsed.problems.join(" ")}`);
  const fixtures = JSON.parse(readFileSync(fixturesFile, "utf8")) as import("../modules/db/repositories/stagingSeedRepository").MirrorFixtures;
  const problems = verifyEvidence(parsed.spec, fixtures.videos);
  if (problems.length > 0) refuse(`a quoted fact is not in its source: ${problems.join(" ")}`);

  console.log(mirrorMode === "fixtures"
    ? `YouTube mirror: INSERT ${fixtures.videos.length} videos and ${fixtures.playlists.length} playlists from the exported fixtures (a snapshot, nothing public, existing rows never changed).`
    : `YouTube mirror: nothing is imported; video ${parsed.spec.recording.youtubeVideoId} must already be in the database from the full sync, public and OBSERVED.`);
  console.log(`Recording: from ${parsed.spec.recording.youtubeVideoId}, as a DRAFT.`);
  console.log(`Catalogue: Composer "${parsed.spec.composer.name}", Work "${parsed.spec.work.title}", Programme "${parsed.spec.programme.title}"${parsed.spec.venue.type ? `, Venue "${parsed.spec.venue.name}" and its Performance` : ""}.`);
  for (const o of parsed.spec.omissions) console.log(`  not loaded: ${o.fact}`);

  if (!execute) {
    console.log("DRY RUN: nothing was connected to or written. Add --execute to load.");
    return 0;
  }

  // From here the application's own database client is bound to the validated target, built from the validated fields (never from the raw string), and the repository's
  // .env can neither add nor override anything.
  const connection = buildStagingConnectionString(target.clientConfig);
  const emptyEnv = path.join(mkdtempSync(path.join(os.tmpdir(), "mm-staging-seed-")), ".env");
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
  const { loadStagingContent } = await import("../modules/seed/loadStagingContent");
  try {
    const readiness = assessReadiness(EXPECTED_MIGRATIONS, await loadReadinessFacts());
    if (!readiness.ready) refuse(`the staging database is not ready (${readiness.code}). Apply the migrations first (docs/runbooks/production-launch.md section 3). Nothing was written.`);
    const report = await loadStagingContent(parsed.spec, fixtures, {}, { mirror: mirrorMode });
    console.log(`YouTube mirror (${report.mirrorMode}): videos ${report.mirror.videosCreated} created / ${report.mirror.videosExisting} existing; playlists ${report.mirror.playlistsCreated} created / ${report.mirror.playlistsExisting} existing; memberships ${report.mirror.membershipsCreated} created.`);
    console.log(`Import actor (no sign-in): ${report.actorCreated ? "created" : "already present"}.`);
    for (const s of report.steps) console.log(`  ${s.outcome.padEnd(8)} ${s.entity} ${s.slug}${s.detail ? ` (${s.detail})` : ""}`);
    console.log("Done. Nothing was published. Next: sign in to Studio as the Founder and review the draft Recording.");
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`FAILED: ${err instanceof Error ? err.name : "unknown error"}${err && typeof err === "object" && "problems" in err ? `: ${(err as { problems: string[] }).problems.join(" ")}` : ""}`); // never the message: it could carry a host or credential
    process.exit(2);
  }
);
