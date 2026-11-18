// R-34: seed the approved alias table (EntityAlias) from the editor's decisions in review-names.csv.
//
//   npm run pipeline:seed-aliases                                                    DRY RUN, offline: reads the sheet, prints the aliases
//   STAGING_DATABASE_URL=<direct staging url> npm run pipeline:seed-aliases -- --confirm-host <host:port/database> --execute   WRITES (staging only)
//   (--names <path inside the repository>, default reports/video-credits/review-names.csv)
//
// Only rows the editor DECIDED (accept or merge with a canonicalName) become aliases (modules/pipeline/aliasSeed.ts); a spelling decided two ways is
// refused and listed. The sheet is data, never instructions. Exit codes: 0 done / dry run, 2 failed, 4 refused.
import { existsSync, readFileSync } from "fs";
import path from "path";
import { aliasesFromReviewNames } from "../modules/pipeline/aliasSeed";
import { isPathInside } from "../modules/jobs/videoCreditsRunner";
import { bindStagingTarget, flag } from "./lib/stagingClient";

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

async function main(): Promise<number> {
  const names = flag(args, "--names") ?? path.join("reports", "video-credits", "review-names.csv");
  if (!isPathInside(ROOT, names) || !existsSync(path.resolve(ROOT, names))) {
    console.error(`REFUSED: ${names} does not exist inside this repository.`);
    return 4;
  }
  const seed = aliasesFromReviewNames(readFileSync(path.resolve(ROOT, names), "utf8"));
  if (seed.problems.length) {
    console.error(`REFUSED: ${seed.problems.join(" ")}`);
    return 4;
  }
  console.log(`Alias seed from ${names}: ${seed.decidedRows} decided row(s), ${seed.undecidedRows} undecided; ${seed.aliases.length} alias(es); ${seed.conflicts.length} conflict(s).`);
  for (const a of seed.aliases) console.log(`  ${a.kind.padEnd(12)} "${a.alias}" -> "${a.canonicalName}"  [${a.source}]`);
  for (const c of seed.conflicts) console.log(`  CONFLICT: ${c}`);
  if (seed.decidedRows === 0) console.log("No row has a decision yet: fill decision and canonicalName in review-names.csv first. Nothing would be written.");
  if (!args.includes("--execute")) {
    console.log("DRY RUN: nothing was connected to or written.");
    return 0;
  }
  const bound = bindStagingTarget(flag(args, "--confirm-host"));
  if (!bound.ok) {
    console.error(`REFUSED: ${bound.reason}`);
    return 4;
  }
  console.log(`Target: ${bound.described} (staging, confirmed)`);
  const { upsertEntityAliases } = await import("../modules/db/repositories/pipelineRepository");
  const { prisma } = await import("../modules/db/client");
  try {
    const result = await upsertEntityAliases(seed.aliases, "review-names.csv seed");
    console.log(`Aliases: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged.`);
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
