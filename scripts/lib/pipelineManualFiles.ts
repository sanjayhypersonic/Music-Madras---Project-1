// R-34 manual mode: the local files shared by pipeline:entities, pipeline:packet and pipeline:import. Everything lives under reports/ (git-ignored):
//   reports/pipeline-manual/entities-queue.csv   the queue (rewritten by each script)
//   reports/pipeline-manual/state.json           packets written, imports executed, approved keys last read
//   reports/pipeline-manual/packets/             research, draft and extraction packets
//   reports/pipeline-manual/imports/             where the owner saves Claude's JSON answers
// The reviewed sheets are read from reports/video-credits/ (or --credits / --names, inside the repository).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { isPathInside } from "../../modules/jobs/videoCreditsRunner";
import { buildEntityQueue, parseState, queueCsv, serializeState, type EntityQueue, type ManualState } from "../../modules/pipeline/entities";
import { MANUAL_DIR } from "../../modules/pipeline/packets";
import { flag } from "./stagingClient";

export const ROOT = path.resolve(__dirname, "..", "..");
export const STATE_FILE = `${MANUAL_DIR}/state.json`;
export const QUEUE_FILE = `${MANUAL_DIR}/entities-queue.csv`;

export const abs = (rel: string) => path.resolve(ROOT, rel);

/** A path given on the command line, refused unless it is inside the repository and exists. */
export function repoFile(rel: string): { ok: true; path: string } | { ok: false; reason: string } {
  if (!isPathInside(ROOT, rel)) return { ok: false, reason: `${rel} is outside this repository` };
  if (!existsSync(abs(rel))) return { ok: false, reason: `${rel} does not exist` };
  return { ok: true, path: abs(rel) };
}

export function readState(): ManualState {
  return parseState(existsSync(abs(STATE_FILE)) ? readFileSync(abs(STATE_FILE), "utf8") : null);
}

export function writeState(state: ManualState): void {
  mkdirSync(abs(MANUAL_DIR), { recursive: true });
  writeFileSync(abs(STATE_FILE), serializeState(state));
}

export function sheetsFrom(args: readonly string[]): { ok: true; creditsCsv: string; namesCsv: string; credits: string; names: string } | { ok: false; reason: string } {
  const credits = flag(args, "--credits") ?? path.join("reports", "video-credits", "review-credits.csv");
  const names = flag(args, "--names") ?? path.join("reports", "video-credits", "review-names.csv");
  for (const f of [credits, names]) {
    const r = repoFile(f);
    if (!r.ok) return r;
  }
  return { ok: true, creditsCsv: readFileSync(abs(credits), "utf8"), namesCsv: readFileSync(abs(names), "utf8"), credits, names };
}

export function loadQueue(args: readonly string[], state: ManualState, approvedKeys?: ReadonlySet<string>): { ok: true; queue: EntityQueue } | { ok: false; reason: string } {
  const sheets = sheetsFrom(args);
  if (!sheets.ok) return sheets;
  const queue = buildEntityQueue({ creditsCsv: sheets.creditsCsv, namesCsv: sheets.namesCsv, state, approvedKeys });
  if (queue.problems.some((p) => /header|missing column|not found/i.test(p)) && queue.entries.length === 0) return { ok: false, reason: queue.problems.join(" ") };
  return { ok: true, queue };
}

export function writeQueue(queue: EntityQueue): void {
  mkdirSync(abs(MANUAL_DIR), { recursive: true });
  writeFileSync(abs(QUEUE_FILE), queueCsv(queue.entries));
}

export function writeReport(rel: string, text: string): void {
  mkdirSync(path.dirname(abs(rel)), { recursive: true });
  writeFileSync(abs(rel), text);
}
