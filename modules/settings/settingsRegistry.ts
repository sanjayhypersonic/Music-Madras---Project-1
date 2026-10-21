import type { StudioAction } from "../auth/policy";

// Phase 6K-1 — the typed site/editorial settings registry. DEFINITIONS live here, in code; only VALUES are stored (table `site_settings`).
//
// What a setting IS (and is not):
//   - a value an authorised person is genuinely expected to change from Studio, without a deployment, that changes an editorial
//     presentation or an operational preference (never security, authorization, rights or public-visibility rules — those are code);
//   - with a named owner, a stated effect, a type, a default, validation, and a required Studio action to view and to change it.
//   - never a secret: the only value kinds are boolean, bounded integer/number, enumerated choice and a record of enumerated choices,
//     so a setting cannot carry free text, a credential or a URL. Credentials and deployment configuration stay in the environment.
// Unknown keys are rejected on write and ignored on read; a stored value that no longer validates falls back to the default and is
// reported. Adding a setting means adding a definition here with a consumer in the same change — no unused options.

export type SettingGroup = "notifications" | "unlistedReview" | "catalogue" | "featured" | "playlistQuality" | "playlistAssistant";

/** How a group is titled in Studio (what the group means to an editor, not its key). */
export const SETTING_GROUP_LABELS: Record<SettingGroup, string> = { notifications: "Notifications", unlistedReview: "Unlisted video review", catalogue: "Public video catalogue", featured: "Featured videos", playlistQuality: "Playlist page quality checks", playlistAssistant: "Playlist interview and drafting assistant" };

export type SettingSensitivity = "EDITORIAL" | "OPERATIONAL";

export type Validation<V> = { ok: true; value: V } | { ok: false; reason: string };

interface SettingSpec<K extends string, V> {
  key: K;
  /** Bumped when the meaning or validation of the setting changes incompatibly; stored values carry the version they were written under. */
  version: number;
  group: SettingGroup;
  label: string;
  description: string;
  /** One sentence: what changes for whom when this value changes. */
  effect: string;
  /** The role or function accountable for the value (documentation; authorization is `changeAction`). */
  owner: string;
  sensitivity: SettingSensitivity;
  viewAction: StudioAction;
  changeAction: StudioAction;
  default: V;
}

export type SettingKind = "boolean" | "integer" | "number" | "enum" | "record";

export interface SettingDefinition<K extends string = string, V = unknown> extends SettingSpec<K, V> {
  kind: SettingKind;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly { value: string; label: string }[];
  /** For `record` settings: the fixed set of entries (the Studio form renders one control per entry). */
  recordKeys?: readonly string[];
  validate(input: unknown): Validation<V>;
}

const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

function assertSpec<K extends string>(spec: SettingSpec<K, unknown>): void {
  if (!KEY_PATTERN.test(spec.key)) throw new Error(`Invalid setting key "${spec.key}".`);
  if (!spec.label.trim() || !spec.description.trim() || !spec.effect.trim() || !spec.owner.trim()) {
    throw new Error(`Setting "${spec.key}" must declare a label, description, effect and owner.`);
  }
}

export function booleanSetting<const K extends string>(spec: SettingSpec<K, boolean>): SettingDefinition<K, boolean> {
  assertSpec(spec);
  return {
    ...spec,
    kind: "boolean",
    validate: (input) => (typeof input === "boolean" ? { ok: true, value: input } : { ok: false, reason: "must be true or false." }),
  };
}

export function integerSetting<const K extends string>(spec: SettingSpec<K, number> & { min: number; max: number }): SettingDefinition<K, number> {
  assertSpec(spec);
  if (!Number.isInteger(spec.default) || spec.default < spec.min || spec.default > spec.max) throw new Error(`Default of "${spec.key}" is out of range.`);
  return {
    ...spec,
    kind: "integer",
    step: 1,
    validate: (input) => {
      if (typeof input !== "number" || !Number.isInteger(input)) return { ok: false, reason: "must be a whole number." };
      if (input < spec.min || input > spec.max) return { ok: false, reason: `must be between ${spec.min} and ${spec.max}.` };
      return { ok: true, value: input };
    },
  };
}

export function numberSetting<const K extends string>(spec: SettingSpec<K, number> & { min: number; max: number; step: number }): SettingDefinition<K, number> {
  assertSpec(spec);
  if (spec.default < spec.min || spec.default > spec.max) throw new Error(`Default of "${spec.key}" is out of range.`);
  return {
    ...spec,
    kind: "number",
    validate: (input) => {
      if (typeof input !== "number" || !Number.isFinite(input)) return { ok: false, reason: "must be a number." };
      if (input < spec.min || input > spec.max) return { ok: false, reason: `must be between ${spec.min} and ${spec.max}.` };
      return { ok: true, value: input };
    },
  };
}

export function enumSetting<const K extends string, const O extends string>(
  spec: SettingSpec<K, O> & { options: readonly { value: O; label: string }[] }
): SettingDefinition<K, O> {
  assertSpec(spec);
  const allowed = new Set<string>(spec.options.map((o) => o.value));
  if (!allowed.has(spec.default)) throw new Error(`Default of "${spec.key}" is not one of its options.`);
  return {
    ...spec,
    kind: "enum",
    validate: (input) => (typeof input === "string" && allowed.has(input) ? { ok: true, value: input as O } : { ok: false, reason: `must be one of: ${[...allowed].join(", ")}.` }),
  };
}

/** A record whose keys are a fixed set and whose values are one of a fixed set of choices. `lockedKeys` cannot be set below their default. */
export function recordSetting<const K extends string>(
  spec: SettingSpec<K, Record<string, string>> & { keys: readonly string[]; choices: readonly string[]; lockedKeys?: readonly string[] }
): SettingDefinition<K, Record<string, string>> {
  assertSpec(spec);
  const keys = new Set(spec.keys);
  const choices = new Set(spec.choices);
  const locked = new Set(spec.lockedKeys ?? []);
  return {
    ...spec,
    kind: "record",
    recordKeys: spec.keys,
    options: spec.choices.map((c) => ({ value: c, label: c })),
    validate: (input) => {
      if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, reason: "must be an object." };
      const record = input as Record<string, unknown>;
      const out: Record<string, string> = { ...spec.default };
      for (const [k, v] of Object.entries(record)) {
        if (!keys.has(k)) return { ok: false, reason: `unknown entry "${k}".` };
        if (typeof v !== "string" || !choices.has(v)) return { ok: false, reason: `entry "${k}" must be one of: ${[...choices].join(", ")}.` };
        if (locked.has(k) && v !== spec.default[k]) return { ok: false, reason: `entry "${k}" is a fixed rule and cannot be changed.` };
        out[k] = v;
      }
      return { ok: true, value: out };
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------------------
// The registry. Each entry has a consumer in code (named in `effect`). Further definitions are added by the phase that builds
// the feature that reads them.

export const SETTING_DEFINITIONS = [
  booleanSetting({
    key: "notifications.email.enabled",
    version: 1,
    group: "notifications",
    label: "Send Studio notifications by email",
    description:
      "In addition to the in-Studio notification inbox (always on), email each notification to the people who can act on it. Emails are only QUEUED when a notification is raised; they are sent by the scheduled delivery job (it needs CRON_SECRET and a scheduler calling /api/cron/stewardship) through the email service the deployment is configured to use. If email is not configured the attempt is recorded as skipped, and if nothing is running the job Studio says emails are waiting. An email counts as delivered only once the mail service has accepted it.",
    effect: "Studio notifications are also queued for email to eligible Studio users and sent by the scheduled delivery job; nothing changes on the public site.",
    owner: "Site operator (Founder / Super Administrator)",
    sensitivity: "OPERATIONAL",
    viewAction: "SETTINGS_MANAGE",
    changeAction: "SETTINGS_MANAGE",
    default: false,
  }),
  booleanSetting({
    key: "unlistedReview.enabled",
    version: 1,
    group: "unlistedReview",
    label: "Look for unlisted videos that may deserve a public page",
    description:
      "When on, the platform identifies unlisted YouTube videos that have not been decided and keeps one notification and one review queue up to date. It never approves, publishes or changes anything on YouTube; it only asks for a decision.",
    effect: "Studio shows (and notifies) a queue of unlisted videos awaiting a decision; switching it off stops the queue being refreshed and the notification being raised.",
    owner: "Editorial lead (people who may publish)",
    sensitivity: "OPERATIONAL",
    viewAction: "CATALOGUE_WRITE",
    changeAction: "RECORDING_PUBLISH",
    default: true,
  }),
  integerSetting({
    key: "unlistedReview.cadenceDays",
    version: 1,
    group: "unlistedReview",
    label: "Reminder interval for unlisted videos awaiting a decision (days)",
    description: "New or changed unlisted videos are announced at once. While videos remain undecided and unchanged, one reminder is raised per this many days — never more.",
    effect: "How often an unchanged, undecided queue is brought back to your attention.",
    owner: "Editorial lead (people who may publish)",
    sensitivity: "EDITORIAL",
    viewAction: "CATALOGUE_WRITE",
    changeAction: "RECORDING_PUBLISH",
    min: 1,
    max: 90,
    default: 7,
  }),
  integerSetting({
    key: "unlistedReview.deferDays",
    version: 1,
    group: "unlistedReview",
    label: "Default length of a deferral (days)",
    description: "When a reviewer defers an unlisted video without choosing a date, it comes back into the queue after this many days.",
    effect: "When a deferred video returns to the queue.",
    owner: "Editorial lead (people who may publish)",
    sensitivity: "EDITORIAL",
    viewAction: "CATALOGUE_WRITE",
    changeAction: "RECORDING_PUBLISH",
    min: 1,
    max: 365,
    default: 30,
  }),
  integerSetting({
    key: "catalogue.videos.pageSize",
    version: 1,
    group: "catalogue",
    label: "Videos per page in the public video catalogue",
    description: "How many videos appear on each page of the public Videos catalogue.",
    effect: "The page size of /videos and the number of pages visitors page through.",
    owner: "Editorial lead (people who may publish)",
    sensitivity: "EDITORIAL",
    viewAction: "CATALOGUE_WRITE",
    changeAction: "RECORDING_PUBLISH",
    min: 6,
    max: 60,
    default: 24,
  }),
  integerSetting({
    key: "featured.homepage.count",
    version: 1,
    group: "featured",
    label: "Featured videos shown on the homepage",
    description: "How many videos the homepage features. Videos you pin come first; any remaining slots are filled automatically if automatic fill is on.",
    effect: "The number of featured videos on the homepage.",
    owner: "Editorial lead (people who may publish)",
    sensitivity: "EDITORIAL",
    viewAction: "CATALOGUE_WRITE",
    changeAction: "RECORDING_PUBLISH",
    min: 1,
    max: 24,
    default: 6,
  }),
  booleanSetting({
    key: "featured.autoFill.enabled",
    version: 1,
    group: "featured",
    label: "Fill unused featured slots automatically",
    description:
      "When on, slots you have not pinned are filled from the videos the Museum lists, ranked by YouTube view count and how recently the video was published. When off, only pinned videos are featured.",
    effect: "Whether the homepage ever shows a featured video you did not pin.",
    owner: "Editorial lead (people who may publish)",
    sensitivity: "EDITORIAL",
    viewAction: "CATALOGUE_WRITE",
    changeAction: "RECORDING_PUBLISH",
    default: true,
  }),
  integerSetting({
    key: "featured.autoFill.recencyWeightPercent",
    version: 1,
    group: "featured",
    label: "How much recency counts in automatic fill (percent)",
    description: "0 ignores how old a video is; 100 lets a very old video's score fall to zero. Views always count. The ranking is explained for every video in Studio.",
    effect: "How strongly newer videos are preferred over older ones when filling slots automatically.",
    owner: "Editorial lead (people who may publish)",
    sensitivity: "EDITORIAL",
    viewAction: "CATALOGUE_WRITE",
    changeAction: "RECORDING_PUBLISH",
    min: 0,
    max: 100,
    default: 50,
  }),
  integerSetting({
    key: "featured.autoFill.recencyHalfLifeDays",
    version: 1,
    group: "featured",
    label: "Recency half-life in automatic fill (days)",
    description: "The age at which a video has lost half of the score recency can remove. Shorter favours newer videos more sharply.",
    effect: "How quickly the recency preference fades as a video ages.",
    owner: "Editorial lead (people who may publish)",
    sensitivity: "EDITORIAL",
    viewAction: "CATALOGUE_WRITE",
    changeAction: "RECORDING_PUBLISH",
    min: 7,
    max: 1825,
    default: 365,
  }),
  booleanSetting({
    key: "playlistQuality.requireSummary",
    version: 1,
    group: "playlistQuality",
    label: "Require a summary before a playlist page can be published",
    description: "The summary says what the playlist is and why its videos belong together.",
    effect: "A playlist page without a summary cannot be published, and a published one without it raises a warning.",
    owner: "Editorial lead (people who may publish)",
    sensitivity: "EDITORIAL",
    viewAction: "CATALOGUE_WRITE",
    changeAction: "RECORDING_PUBLISH",
    default: true,
  }),
  integerSetting({
    key: "playlistQuality.minEligibleVideos",
    version: 1,
    group: "playlistQuality",
    label: "Minimum videos a playlist page must be able to show",
    description: "Only videos the Museum can show on that playlist page count: not drafts, not private, and unlisted videos only with approval for that playlist.",
    effect: "A playlist page with fewer showable videos cannot be published.",
    owner: "Editorial lead (people who may publish)",
    sensitivity: "EDITORIAL",
    viewAction: "CATALOGUE_WRITE",
    changeAction: "RECORDING_PUBLISH",
    min: 1,
    max: 50,
    default: 3,
  }),
  booleanSetting({
    key: "playlistQuality.requireSeoDescription",
    version: 1,
    group: "playlistQuality",
    label: "Require a search description before a playlist page can be published",
    description: "The text search engines may show under the page title.",
    effect: "A playlist page without a search description cannot be published.",
    owner: "Editorial lead (people who may publish)",
    sensitivity: "EDITORIAL",
    viewAction: "CATALOGUE_WRITE",
    changeAction: "RECORDING_PUBLISH",
    default: true,
  }),
  integerSetting({
    key: "playlistQuality.minContextInputs",
    version: 1,
    group: "playlistQuality",
    label: "Pieces of human-supplied context a playlist page needs",
    description:
      "Answers to the interview questions or notes an editor adds about why these videos were chosen. 0 switches this check off. The platform never invents context: drafts are written only from what has been supplied and approved.",
    effect: "A playlist page with less supplied context cannot be published.",
    owner: "Editorial lead (people who may publish)",
    sensitivity: "EDITORIAL",
    viewAction: "CATALOGUE_WRITE",
    changeAction: "RECORDING_PUBLISH",
    min: 0,
    max: 20,
    default: 3,
  }),
  booleanSetting({
    key: "playlistAssistant.enabled",
    version: 1,
    group: "playlistAssistant",
    label: "Offer the AI interview and drafting assistant on playlist pages",
    description:
      "When on, an editor can ask the assistant for the next interview question and for a draft summary or body. The assistant asks one question at a time, drafts only from the supplied evidence, and can never publish, approve rights, or approve an unlisted video. It also needs an AI provider configured for the deployment.",
    effect: "Whether the assistant buttons appear and work on playlist pages.",
    owner: "Editorial lead (people who may publish)",
    sensitivity: "OPERATIONAL",
    viewAction: "CATALOGUE_WRITE",
    changeAction: "RECORDING_PUBLISH",
    default: true,
  }),
  integerSetting({
    key: "playlistAssistant.maxQuestions",
    version: 1,
    group: "playlistAssistant",
    label: "Most interview questions the assistant may ask per playlist page",
    description: "A bound on the interview so it cannot go on indefinitely. Skipped and withdrawn questions count.",
    effect: "After this many questions the assistant stops asking and the editor adds notes instead.",
    owner: "Editorial lead (people who may publish)",
    sensitivity: "EDITORIAL",
    viewAction: "CATALOGUE_WRITE",
    changeAction: "RECORDING_PUBLISH",
    min: 1,
    max: 30,
    default: 8,
  }),
] as const;

export type SettingDefinitions = typeof SETTING_DEFINITIONS;
export type SettingKey = SettingDefinitions[number]["key"];
export type SettingValueOf<K extends SettingKey> = Extract<SettingDefinitions[number], { key: K }>["default"];

const BY_KEY = new Map<string, SettingDefinition>(SETTING_DEFINITIONS.map((d) => [d.key, d as unknown as SettingDefinition]));

export function findSettingDefinition(key: string): SettingDefinition | undefined {
  return BY_KEY.get(key);
}

export function listSettingDefinitions(): readonly SettingDefinition[] {
  return SETTING_DEFINITIONS as unknown as readonly SettingDefinition[];
}
