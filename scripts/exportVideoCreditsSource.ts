// Credits extraction, route 2: export the videos whose credits will be proposed, from the STAGING database, READ-ONLY.
//
//   npm run ai:video-credits-export -- --settings-file <settings file>                                  counts only, writes nothing
//   npm run ai:video-credits-export -- --settings-file <settings file> --limit 25 --offset 0 --write    also writes reports/video-credits/export-….json
//   (--out <path inside the repository> overrides the file name; it needs --write)
//
// Not --env-file: that is Node's own option name. Through tsx, a MISSING --env-file makes Node itself exit ("…: not found", code 9) before the script
// runs, and placed before the script name Node loads EVERY line of the file into the environment. The script refuses --env-file and names
// --settings-file instead (pinned by tests/unit/videoCreditsExportScript.test.ts).
//
// Safety (modules/jobs/videoCreditsExport.ts and modules/db/repositories/videoCreditsExportQuery.ts):
//   - the script reads the --settings-file file itself and takes only DATABASE_URL from it; no line of the file is put into the environment. If any
//     setting from the file is ALREADY in the environment with the same value (the file was loaded by something else), it refuses;
//   - the shell's DATABASE_URL / DIRECT_URL and the repository's .env files are ignored;
//   - the database name must contain "staging" and neither "prod" nor "test"; NODE_ENV must not be production;
//   - one transaction, first statement SET TRANSACTION READ ONLY, then only a count and a select;
//   - only the host and the database name are printed; an error prints its kind, never its message (it could carry a host or credential);
//   - the only write is the export file, inside this repository.
// Exit codes: 0 done, 2 failed, 4 refused.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { parse } from "dotenv";
import {
  VIDEO_CREDITS_EXPORT_EXIT_CODES,
  buildVideoCreditsExportFile,
  defaultExportPath,
  describeExportTarget,
  findSettingsAlreadyInEnvironment,
  parseVideoCreditsExportArgs,
  resolveVideoCreditsExportTarget,
} from "../modules/jobs/videoCreditsExport";
import { isPathInside } from "../modules/jobs/videoCreditsRunner";

const ROOT = path.resolve(__dirname, "..");

function refuse(message: string): number {
  console.error(`REFUSED: ${message}`);
  return VIDEO_CREDITS_EXPORT_EXIT_CODES.REFUSED;
}

async function main(): Promise<number> {
  const parsed = parseVideoCreditsExportArgs(process.argv.slice(2));
  if (!parsed.ok) return refuse(parsed.error);
  const { args } = parsed;

  const settingsFile = path.resolve(args.settingsFile);
  if (!existsSync(settingsFile)) return refuse("the --settings-file file does not exist.");
  // The file is parsed into a local object only. Only DATABASE_URL is used; nothing from it is printed or copied into the environment.
  const settings = parse(readFileSync(settingsFile));
  const leaked = findSettingsAlreadyInEnvironment(settings, process.env);
  if (leaked.length > 0) {
    return refuse(
      `${leaked.length} setting(s) from the settings file are already in the environment (${leaked.join(", ")}): the file was loaded by something else, such as Node's --env-file. Run again with only --settings-file.`
    );
  }
  const databaseUrl = settings.DATABASE_URL;
  const resolved = resolveVideoCreditsExportTarget({ databaseUrl, nodeEnv: process.env.NODE_ENV });
  if (!resolved.ok) return refuse(resolved.reason);
  const { target } = resolved;

  const generatedAt = new Date();
  let outPath: string | null = null;
  if (args.write && args.outFile !== null) {
    if (!isPathInside(ROOT, args.outFile)) return refuse("--out must be a path inside this repository.");
    outPath = path.resolve(ROOT, args.outFile);
  }

  console.log(`Video credits export — READ-ONLY from ${describeExportTarget(target)} (staging)`);
  console.log(`  Batch: offset ${args.offset}, ${args.limit === null ? "no limit" : `limit ${args.limit}`}; ${args.write ? "will write the export file" : "counts only, nothing will be written (add --write)"}`);

  // Bind the application's database client to the checked target, built from its parsed fields, and stop the repository's .env from adding to or
  // overriding anything. The client is imported only after this.
  const emptyEnv = path.join(mkdtempSync(path.join(os.tmpdir(), "mm-credits-export-")), ".env");
  writeFileSync(emptyEnv, "");
  process.env.DOTENV_CONFIG_PATH = emptyEnv;
  process.env.DOTENV_CONFIG_QUIET = "true";
  process.env.DATABASE_URL = target.connectionString;
  delete process.env.DIRECT_URL;
  delete process.env.TEST_DATABASE_URL;
  delete process.env.TEST_DIRECT_URL;

  const { exportVideoCreditsSource, disconnectVideoCreditsExport } = await import("../modules/db/repositories/videoCreditsExportRepository");
  try {
    const { totalMatching, rows } = await exportVideoCreditsSource({ limit: args.limit, offset: args.offset });
    const { file, droppedBlankDescriptions } = buildVideoCreditsExportFile({ generatedAt, target, args, totalMatching, rows });
    console.log(`  Videos matching (public, observed, with a description): ${totalMatching}`);
    console.log(`  In this batch: ${file.videos.length}${droppedBlankDescriptions > 0 ? ` (${droppedBlankDescriptions} with a blank description left out)` : ""}`);
    if (!args.write) {
      console.log("Nothing was written. Add --write to write the export file.");
      return VIDEO_CREDITS_EXPORT_EXIT_CODES.SUCCEEDED;
    }
    const finalPath = outPath ?? path.resolve(ROOT, defaultExportPath(generatedAt, args.offset, file.videos.length));
    mkdirSync(path.dirname(finalPath), { recursive: true });
    writeFileSync(finalPath, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`Export written: ${path.relative(ROOT, finalPath)}`);
    console.log("The database was only read (one read-only transaction).");
    return VIDEO_CREDITS_EXPORT_EXIT_CODES.SUCCEEDED;
  } finally {
    await disconnectVideoCreditsExport();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`FAILED: ${error instanceof Error ? error.name : "unknown error"} (details are not printed: they could contain connection information)`);
    process.exitCode = VIDEO_CREDITS_EXPORT_EXIT_CODES.FAILED;
  }
);
