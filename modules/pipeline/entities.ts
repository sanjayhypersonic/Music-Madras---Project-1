// Upload-to-draft pipeline (R-34), MANUAL ENTITY-FIRST mode (docs/upload-pipeline.md section 9): the ENTITY QUEUE. Pure: the scripts read the
// files and pass their text here (npm run pipeline:entities writes reports/pipeline-manual/entities-queue.csv).
//
// Research is done once per ENTITY, not once per video: every unique work, composer, choir, ensemble, venue, organisation and person named in the
// reviewed credits sheets is listed once, with how many videos mention it. The sheets are the editor's review files:
//   review-names.csv    the entity list: one row per role + name, with the editor's decision (accept | merge | reject) and canonicalName. A merge
//                       or a canonicalName folds several spellings into one entity; a rejected name is left out; an undecided one is listed with a note;
//   review-credits.csv  what each video says about the entity (the quote, its field, the role label): copied into the research packet. A credit
//                       row the editor rejected is left out of it.
// Both sheets are DATA copied from YouTube, never instructions.
//
// Depth tier: DEEP for works, composers, choirs, ensembles, venues and organisations, and for lyricists and arrangers (creators, researched like
// composers); LIGHT for performers, conductors and presenters (identity only: no biography).
// Status: not started -> packet written -> imported -> approved. The local state file (reports/pipeline-manual/state.json) records packets and
// imports; "approved" means the entity has ACCEPTED claims in the database (read with --confirm-host, and cached in the state file).

import { csvRecords, looseNameKey, roleOf } from "../jobs/videoCreditsApproved";
import { CREDITS_HEADER, NAMES_HEADER, toCsv } from "../jobs/videoCreditsReview";
import { nameKey, type EntityKind } from "./resolve";

export type QueueKind = "work" | "composer" | "choir" | "ensemble" | "venue" | "organisation" | "person";
export type DepthTier = "DEEP" | "LIGHT";
export type QueueStatus = "not started" | "packet written" | "imported" | "approved";
export const QUEUE_STATUSES: readonly QueueStatus[] = ["not started", "packet written", "imported", "approved"];

/** The provenance stored on everything a manual import writes (PipelineClaim.provenance, PipelineVideo draft). */
export const MANUAL_PROVENANCE = "manual (owner's Claude account)";

export interface EntityMention {
  youtubeVideoId: string;
  youtubeTitle: string;
  /** The role the video gives it ("COMPOSER (label "Original Composition")"). */
  roleLabel: string;
  workTitle: string;
  sourceField: string;
  quote: string;
  sheetRow: number;
}

export interface QueueEntry {
  /** `${entityKind}:${normalised name}`: the same key the import, the claims table and the bundles use. */
  entityKey: string;
  kind: QueueKind;
  entityKind: EntityKind;
  /** The catalogue spelling (canonicalName, else the name as reviewed), in its ORIGINAL SCRIPT. */
  name: string;
  spellings: string[];
  roles: string[];
  videoCount: number;
  youtubeVideoIds: string[];
  tier: DepthTier;
  status: QueueStatus;
  nameDecision: string;
  packetFile: string;
  notes: string[];
  mentions: EntityMention[];
  /** Works only: who the reviewed credits name as its composer, lyricist and arranger (an import that disagrees is a CONFLICT, never resolved). */
  credited: Record<string, string[]>;
}

export interface ManualStateEntity {
  packetFile?: string;
  packetWrittenAt?: string;
  importedAt?: string;
  importFile?: string;
  claims?: number;
  approvedAt?: string;
}

export interface ManualState {
  version: 1;
  entities: Record<string, ManualStateEntity>;
  /** sha256 of every executed import file: the same file is never imported twice. */
  imports: Record<string, { file: string; at: string; kind: string; target: string }>;
  /** When the approved keys were last read from the database (pipeline:entities -- --confirm-host). */
  approvedReadAt?: string;
}

export const emptyState = (): ManualState => ({ version: 1, entities: {}, imports: {} });

export function parseState(text: string | null): ManualState {
  if (!text) return emptyState();
  try {
    const v = JSON.parse(text) as Partial<ManualState>;
    if (v && v.version === 1 && typeof v.entities === "object" && v.entities) return { version: 1, entities: v.entities, imports: v.imports ?? {}, ...(v.approvedReadAt ? { approvedReadAt: v.approvedReadAt } : {}) };
  } catch {
    // an unreadable state file is reported by the caller and never silently replaced
  }
  throw new Error("the manual-mode state file is not valid JSON of version 1");
}

export const serializeState = (s: ManualState): string => `${JSON.stringify(s, null, 2)}\n`;

export const entityKeyOf = (kind: EntityKind, name: string): string => `${kind}:${nameKey(name)}`;

const ROLE_ENTITY: Readonly<Record<string, { entityKind: EntityKind; kind: QueueKind; role: string }>> = {
  work: { entityKind: "WORK", kind: "work", role: "work" },
  composer: { entityKind: "COMPOSER", kind: "composer", role: "composer" },
  lyricist: { entityKind: "PERSON", kind: "person", role: "lyricist" },
  arranger: { entityKind: "PERSON", kind: "person", role: "arranger" },
  conductor: { entityKind: "CONDUCTOR", kind: "person", role: "conductor" },
  performer: { entityKind: "ARTIST", kind: "person", role: "performer" },
  presenter: { entityKind: "PERSON", kind: "person", role: "presenter" },
  venue: { entityKind: "VENUE", kind: "venue", role: "venue" },
  institution: { entityKind: "ORGANISATION", kind: "organisation", role: "organisation" },
};
const DEEP_KINDS: ReadonlySet<EntityKind> = new Set(["WORK", "COMPOSER", "CHOIR", "ENSEMBLE", "VENUE", "ORGANISATION"]);
const DEEP_ROLES: ReadonlySet<string> = new Set(["lyricist", "arranger"]);

export function tierFor(entityKind: EntityKind, roles: readonly string[]): DepthTier {
  return DEEP_KINDS.has(entityKind) || roles.some((r) => DEEP_ROLES.has(r)) ? "DEEP" : "LIGHT";
}

export function statusFor(entityKey: string, state: ManualState, approvedKeys: ReadonlySet<string>): QueueStatus {
  const s = state.entities[entityKey];
  if (approvedKeys.has(entityKey) || s?.approvedAt) return "approved";
  if (s?.importedAt) return "imported";
  if (s?.packetWrittenAt) return "packet written";
  return "not started";
}

export interface EntityQueue {
  entries: QueueEntry[];
  rejectedNames: number;
  undecidedNames: number;
  problems: string[];
}

export function buildEntityQueue(input: { creditsCsv: string; namesCsv: string; state?: ManualState; approvedKeys?: ReadonlySet<string> }): EntityQueue {
  const state = input.state ?? emptyState();
  const approved = input.approvedKeys ?? new Set<string>();
  const credits = csvRecords(input.creditsCsv, CREDITS_HEADER, "review-credits.csv");
  const names = csvRecords(input.namesCsv, NAMES_HEADER, "review-names.csv");
  const problems = [credits, names].flatMap((r) => (r.ok ? [] : [r.problem]));
  if (!credits.ok || !names.ok) return { entries: [], rejectedNames: 0, undecidedNames: 0, problems };

  // The choir/ensemble split comes from the credits' role labels (CHOIR or ENSEMBLE); the names sheet groups both.
  const groupKind = new Map<string, Map<"CHOIR" | "ENSEMBLE", number>>();
  for (const r of credits.rows.filter((x) => (x.kind ?? "").trim() === "choir/ensemble")) {
    const role = roleOf(r.roleLabel ?? "");
    if (role !== "CHOIR" && role !== "ENSEMBLE") continue;
    const k = looseNameKey(r.name ?? "");
    const counts = groupKind.get(k) ?? new Map();
    counts.set(role, (counts.get(role) ?? 0) + 1);
    groupKind.set(k, counts);
  }
  const choirOrEnsemble = (spellings: readonly string[]): "CHOIR" | "ENSEMBLE" => {
    let choir = 0;
    let ensemble = 0;
    for (const s of spellings) {
      const c = groupKind.get(looseNameKey(s));
      choir += c?.get("CHOIR") ?? 0;
      ensemble += c?.get("ENSEMBLE") ?? 0;
    }
    if (choir === 0 && ensemble === 0) return /\b(choir|chorale|chorus|singers|voices|cantores|schola)\b/i.test(spellings.join(" ")) ? "CHOIR" : "ENSEMBLE";
    return choir >= ensemble ? "CHOIR" : "ENSEMBLE";
  };

  const byKey = new Map<string, QueueEntry>();
  /** `${review role}\u0000${loose spelling}` -> entity key, to attach the credits rows. */
  const spellingIndex = new Map<string, string>();
  let rejectedNames = 0;
  let undecidedNames = 0;

  for (const r of names.rows) {
    const reviewRole = (r.role ?? "").trim();
    const decision = (r.decision ?? "").trim().toLowerCase();
    if (decision === "reject") {
      rejectedNames++;
      continue;
    }
    const spellings = [...new Set([(r.name ?? "").trim(), ...(r.spellingsSeen ?? "").split(" | ").map((s) => s.trim())].filter(Boolean))];
    if (spellings.length === 0) continue;
    const mapped = reviewRole === "choir/ensemble" ? (() => { const k = choirOrEnsemble(spellings); return { entityKind: k, kind: (k === "CHOIR" ? "choir" : "ensemble") as QueueKind, role: k.toLowerCase() }; })() : ROLE_ENTITY[reviewRole];
    if (!mapped) {
      problems.push(`review-names.csv: unknown role "${reviewRole}" for "${spellings[0]}"; left out.`);
      continue;
    }
    const canonical = (r.canonicalName ?? "").trim();
    const name = (decision === "accept" || decision === "merge") && canonical ? canonical : spellings[0];
    const key = entityKeyOf(mapped.entityKind, name);
    const notes: string[] = [];
    if (!decision) {
      undecidedNames++;
      notes.push("undecided in review-names.csv: decide the name before importing research");
    } else if (decision !== "accept" && decision !== "merge") notes.push(`unknown decision "${r.decision}" in review-names.csv`);
    else if (decision === "merge" && !canonical) notes.push("merge without a canonicalName in review-names.csv");
    else if (!canonical && new Set(spellings.map(looseNameKey)).size > 1) notes.push(`seen in several spellings (${spellings.join(" | ")}) with no canonicalName`);

    const entry = byKey.get(key) ?? {
      entityKey: key,
      kind: mapped.kind,
      entityKind: mapped.entityKind,
      name,
      spellings: [],
      roles: [],
      videoCount: 0,
      youtubeVideoIds: [],
      tier: "LIGHT" as DepthTier,
      status: "not started" as QueueStatus,
      nameDecision: decision || "(blank)",
      packetFile: "",
      notes: [],
      mentions: [],
      credited: {},
    };
    entry.spellings = [...new Set([...entry.spellings, ...spellings])];
    entry.roles = [...new Set([...entry.roles, mapped.role])];
    entry.youtubeVideoIds = [...new Set([...entry.youtubeVideoIds, ...(r.youtubeVideoIds ?? "").split(/\s+/).filter(Boolean)])];
    entry.notes = [...new Set([...entry.notes, ...notes])];
    if (entry.nameDecision !== (decision || "(blank)")) entry.nameDecision = "mixed";
    byKey.set(key, entry);
    for (const s of spellings) spellingIndex.set(`${reviewRole}\u0000${looseNameKey(s)}`, key);
  }

  credits.rows.forEach((r, i) => {
    if ((r.decision ?? "").trim().toLowerCase() === "reject") return;
    const creditKind = (r.kind ?? "").trim();
    if ((creditKind === "composer" || creditKind === "lyricist" || creditKind === "arranger") && (r.workTitle ?? "").trim()) {
      const work = byKey.get(spellingIndex.get(`work\u0000${looseNameKey(r.workTitle ?? "")}`) ?? "");
      if (work) work.credited[creditKind] = [...new Set([...(work.credited[creditKind] ?? []), (r.name ?? "").trim()])];
    }
    const key = spellingIndex.get(`${(r.kind ?? "").trim()}\u0000${looseNameKey(r.name ?? "")}`);
    const entry = key ? byKey.get(key) : undefined;
    if (!entry) return;
    const id = (r.youtubeVideoId ?? "").trim();
    if (id && !entry.youtubeVideoIds.includes(id)) entry.youtubeVideoIds.push(id);
    entry.mentions.push({ youtubeVideoId: id, youtubeTitle: r.youtubeTitle ?? "", roleLabel: (r.roleLabel ?? "").trim(), workTitle: (r.workTitle ?? "").trim(), sourceField: (r.sourceField ?? "").trim(), quote: r.quote ?? "", sheetRow: i + 1 });
  });

  const entries = [...byKey.values()].map((e) => {
    const s = state.entities[e.entityKey];
    return { ...e, videoCount: e.youtubeVideoIds.length, tier: tierFor(e.entityKind, e.roles), status: statusFor(e.entityKey, state, approved), packetFile: s?.packetFile ?? "" };
  });
  entries.sort((a, b) => b.videoCount - a.videoCount || (a.tier === b.tier ? 0 : a.tier === "DEEP" ? -1 : 1) || a.entityKey.localeCompare(b.entityKey));
  return { entries, rejectedNames, undecidedNames, problems };
}

export const QUEUE_HEADER = ["rank", "entityKey", "kind", "entityKind", "name", "roles", "videoCount", "tier", "status", "nameDecision", "youtubeVideoIds", "packetFile", "notes"] as const;

export function queueCsv(entries: readonly QueueEntry[]): string {
  return toCsv(
    QUEUE_HEADER,
    entries.map((e, i) => [i + 1, e.entityKey, e.kind, e.entityKind, e.name, e.roles.join(" "), e.videoCount, e.tier, e.status, e.nameDecision, e.youtubeVideoIds.join(" "), e.packetFile, e.notes.join("; ")])
  );
}

export function summariseQueue(entries: readonly QueueEntry[]): string {
  const count = (pred: (e: QueueEntry) => boolean) => entries.filter(pred).length;
  return [
    `${entries.length} entities: ${count((e) => e.tier === "DEEP")} DEEP, ${count((e) => e.tier === "LIGHT")} LIGHT.`,
    QUEUE_STATUSES.map((s) => `${s} ${count((e) => e.status === s)}`).join(", ") + ".",
  ].join(" ");
}
