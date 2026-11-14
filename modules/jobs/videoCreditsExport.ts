// Credits extraction, route 2: the PURE parts of scripts/exportVideoCreditsSource.ts (arguments, the database guard, the export file). No fs, no
// network, no database, so all of it is unit-tested.
//
// The export reads the STAGING database (never production, never a test database) and writes a local JSON file of the videos a person, or a
// Claude Code session, will read to propose credits. Rules:
//   - the database comes ONLY from DATABASE_URL in the settings file named by --env-file; nothing else in the environment or the repository's .env
//     files is used;
//   - the database name must contain "staging" and must contain neither "prod" nor "test" (plain substrings, case-insensitive);
//   - only the host and the database name are ever printed, never a user name, password or query string;
//   - the read is SELECT-only inside one transaction whose first statement is SET TRANSACTION READ ONLY
//     (modules/db/repositories/videoCreditsExportRepository.ts);
//   - without --write nothing is written; with it, one file under reports/video-credits/ (or --out, which must stay inside the repository).

import path from "path";
import type { VideoCreditsExportRow } from "../db/repositories/videoCreditsExportQuery";

export type { VideoCreditsExportRow };

export const VIDEO_CREDITS_EXPORT_EXIT_CODES = { SUCCEEDED: 0, FAILED: 2, REFUSED: 4 } as const;

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Arguments

export interface VideoCreditsExportArgs {
  envFile: string;
  limit: number | null;
  offset: number;
  write: boolean;
  outFile: string | null;
}

const VALUE_FLAGS = new Set(["--env-file", "--limit", "--offset", "--out"]);

export function parseVideoCreditsExportArgs(argv: readonly string[]): { ok: true; args: VideoCreditsExportArgs } | { ok: false; error: string } {
  const values = new Map<string, string>();
  let write = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--write") {
      write = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) return { ok: false, error: `Unknown argument "${flag}".` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return { ok: false, error: `${flag} needs a value.` };
    values.set(flag, value);
    i++;
  }
  const envFile = values.get("--env-file");
  if (!envFile) return { ok: false, error: "--env-file <file> is required: the settings file whose DATABASE_URL names the STAGING database. Nothing else is read." };
  let limit: number | null = null;
  if (values.has("--limit")) {
    limit = Number(values.get("--limit"));
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return { ok: false, error: "--limit must be a whole number from 1 to 1000." };
  }
  let offset = 0;
  if (values.has("--offset")) {
    offset = Number(values.get("--offset"));
    if (!Number.isInteger(offset) || offset < 0) return { ok: false, error: "--offset must be a whole number, 0 or more." };
  }
  const outFile = values.get("--out") ?? null;
  if (outFile !== null && !write) return { ok: false, error: "--out only makes sense with --write." };
  return { ok: true, args: { envFile, limit, offset, write, outFile } };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The database guard

export interface ExportTarget {
  host: string;
  port: string;
  database: string;
  /** postgresql://user:password@host:port/database?sslmode=require, rebuilt from the parsed fields (the original query string is dropped). */
  connectionString: string;
}

export const describeExportTarget = (t: Pick<ExportTarget, "host" | "database">): string => `${t.host}/${t.database}`;

/**
 * Decides whether DATABASE_URL may be read for the export. Pure. Every refusal names at most the host and the database, never a credential.
 */
export function resolveVideoCreditsExportTarget(input: { databaseUrl: string | undefined; nodeEnv: string | undefined }): { ok: true; target: ExportTarget } | { ok: false; reason: string } {
  if (input.nodeEnv === "production") return { ok: false, reason: "NODE_ENV is production. The export only reads a staging database." };
  const raw = input.databaseUrl?.trim();
  if (!raw) return { ok: false, reason: "The settings file has no DATABASE_URL." };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "DATABASE_URL in the settings file is not a valid URL." };
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") return { ok: false, reason: "DATABASE_URL in the settings file is not a postgresql:// URL." };
  const host = url.hostname.toLowerCase();
  const port = url.port || "5432";
  let database: string;
  try {
    database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    return { ok: false, reason: "The database name in DATABASE_URL cannot be read." };
  }
  if (!host) return { ok: false, reason: "DATABASE_URL in the settings file has no host." };
  if (!database || database.includes("/")) return { ok: false, reason: `DATABASE_URL on ${host} does not name exactly one database.` };

  const named = describeExportTarget({ host, database });
  const lower = database.toLowerCase();
  if (lower.includes("prod")) return { ok: false, reason: `The database ${named} looks like a production database ("prod" in its name). The export only reads staging.` };
  if (lower.includes("test")) return { ok: false, reason: `The database ${named} looks like a test database ("test" in its name). The export only reads staging.` };
  if (!lower.includes("staging")) return { ok: false, reason: `The database ${named} does not have "staging" in its name. The export only reads staging.` };
  if (!url.username) return { ok: false, reason: `DATABASE_URL for ${named} has no user name.` };

  const auth = url.password ? `${url.username}:${url.password}` : url.username; // both stay percent-encoded exactly as given
  return { ok: true, target: { host, port, database, connectionString: `postgresql://${auth}@${host}:${port}/${encodeURIComponent(database)}?sslmode=require` } };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The export file

/** One video in the export file: what the proposals are checked against. */
export interface ExportedVideo {
  youtubeVideoId: string;
  title: string | null;
  description: string | null;
  publishedAt: string | null;
  playlistTitles: string[];
}

export interface VideoCreditsExportFile {
  kind: "video-credits-export";
  version: 1;
  generatedAt: string;
  source: { host: string; database: string };
  filter: string;
  offset: number;
  limit: number | null;
  totalMatching: number;
  videos: ExportedVideo[];
}

export const EXPORT_FILTER_DESCRIPTION =
  "privacyStatus = public, observabilityState = OBSERVED (seen in the latest sync), description not empty; ordered by publishedAt then youtubeVideoId; playlist titles from OBSERVED public playlists only";

export const isUsableDescription = (description: string | null): boolean => (description ?? "").trim().length > 0;

export function toExportedVideo(row: VideoCreditsExportRow): ExportedVideo {
  const playlistTitles = [...new Set(row.playlistTitles.map((t) => (t ?? "").trim()).filter((t) => t.length > 0))].sort((a, b) => a.localeCompare(b));
  return { youtubeVideoId: row.youtubeVideoId, title: row.title, description: row.description, publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null, playlistTitles };
}

export function buildVideoCreditsExportFile(input: {
  generatedAt: Date;
  target: Pick<ExportTarget, "host" | "database">;
  args: Pick<VideoCreditsExportArgs, "offset" | "limit">;
  totalMatching: number;
  rows: VideoCreditsExportRow[];
}): { file: VideoCreditsExportFile; droppedBlankDescriptions: number } {
  const usable = input.rows.filter((r) => isUsableDescription(r.description));
  return {
    droppedBlankDescriptions: input.rows.length - usable.length,
    file: {
      kind: "video-credits-export",
      version: 1,
      generatedAt: input.generatedAt.toISOString(),
      source: { host: input.target.host, database: input.target.database },
      filter: EXPORT_FILTER_DESCRIPTION,
      offset: input.args.offset,
      limit: input.args.limit,
      totalMatching: input.totalMatching,
      videos: usable.map(toExportedVideo),
    },
  };
}

/** reports/video-credits/export-o0000-n25-<timestamp>.json, relative to the repository root. */
export const defaultExportPath = (generatedAt: Date, offset: number, count: number): string =>
  path.join("reports", "video-credits", `export-o${String(offset).padStart(4, "0")}-n${count}-${generatedAt.toISOString().replace(/[:.]/g, "-")}.json`);
