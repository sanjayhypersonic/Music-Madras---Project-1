import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { can } from "../../../../../modules/auth/policy";
import { listContentSuggestionsForStudio } from "../../../../../modules/db/repositories/contentSuggestionRepository";
import { listRecordingsForStudio } from "../../../../../modules/db/repositories/recordingRepository";
import { getRecordingDisplayTitles } from "../../../../../modules/db/repositories/editorialQueueRepository";
import { isRecordingPublished } from "../../../../../modules/mmke/catalogue/isRecordingPublished";
import { formatAuditTimestamp } from "../../../../../modules/audit/auditDisplay";
import { generateEditorialSuggestionAction } from "./generateAction";
import type { ContentSuggestionStatus, ContentSuggestionType } from "@prisma/client";

// Phase 6H-4 — the Studio Content Suggestions list, mirroring the existing
// Audit Log page's URL-filter convention (6G-15). RECORDING_WRITE-gated
// for viewing (docs/content-intelligence-architecture.md Phase 6H-2 §34:
// the same permission that already allows creating/editing a Recording
// draft) — never exposed publicly (no sitemap entry, no Museum route).
//
// Phase 6H-6 adds the "Generate an editorial suggestion" section: the
// first real, explicit trigger into the AI Generation Gateway (6H-5). Only
// PUBLISHED recordings are offered — the gateway's own default context mode
// (docs/content-intelligence-architecture.md Phase 6H-6, "prefer the
// canonical PUBLISHED context").

const STATUS_OPTIONS: ContentSuggestionStatus[] = ["DRAFT_READY", "EDITOR_REVIEW", "CHANGES_REQUESTED", "APPROVED", "REJECTED"];
const TYPE_OPTIONS: ContentSuggestionType[] = [
  "EDITORIAL_PROSE",
  "SEO_METADATA",
  "INTERNAL_LINK",
  "INFORMATION_GAP",
  "SOURCE_LEAD",
  "SEARCH_TERMINOLOGY",
  "CANONICAL_RELATIONSHIP_CANDIDATE",
];

interface ListSearchParams {
  status?: string;
  suggestionType?: string;
  error?: string;
}

function isContentSuggestionStatus(value: string): value is ContentSuggestionStatus {
  return (STATUS_OPTIONS as string[]).includes(value);
}

function isContentSuggestionType(value: string): value is ContentSuggestionType {
  return (TYPE_OPTIONS as string[]).includes(value);
}

function recordingLabel(recording: {
  slug: string;
  currentPublishedRevision: { title: string | null } | null;
  currentDraftRevision: { title: string | null } | null;
}): string {
  return recording.currentPublishedRevision?.title ?? recording.currentDraftRevision?.title ?? recording.slug;
}

export default async function ContentSuggestionsPage({ searchParams }: { searchParams: Promise<ListSearchParams> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  if (!can(session.user.role, "RECORDING_WRITE")) {
    return <p>You do not have permission to view Content Suggestions.</p>;
  }

  const params = await searchParams;
  const status = params.status && isContentSuggestionStatus(params.status) ? params.status : undefined;
  const suggestionType = params.suggestionType && isContentSuggestionType(params.suggestionType) ? params.suggestionType : undefined;

  const [suggestions, allRecordingSuggestions, allRecordings] = await Promise.all([
    listContentSuggestionsForStudio({ status, suggestionType }),
    listContentSuggestionsForStudio({ targetEntityType: "RECORDING" }),
    listRecordingsForStudio(),
  ]);

  // Phase 6I-3: the Target column shows the Recording's title (resolved from its
  // revisions in one query), never the raw id.
  const recordingTitles = await getRecordingDisplayTitles(
    suggestions.filter((suggestion) => suggestion.targetEntityType === "RECORDING").map((suggestion) => suggestion.targetEntityId)
  );

  const eligibleRecordings = allRecordings.filter((recording) => isRecordingPublished(recording));
  const suggestionCountByRecordingId = new Map<string, number>();
  for (const suggestion of allRecordingSuggestions) {
    suggestionCountByRecordingId.set(suggestion.targetEntityId, (suggestionCountByRecordingId.get(suggestion.targetEntityId) ?? 0) + 1);
  }

  return (
    <div>
      <h1>Content Suggestions</h1>
      <p>
        Proposed editorial changes awaiting human review. A suggestion never becomes canonical or public on its own — see{" "}
        <Link href="/studio/audit">the audit log</Link> for the full history of every decision made here.
      </p>
      {params.error && <p style={{ color: "#b00020" }}>{decodeURIComponent(params.error)}</p>}

      <h2>Generate an editorial suggestion</h2>
      <p style={{ fontSize: "0.9rem", color: "#666" }}>
        This produces an AI-generated <strong>draft</strong> requiring editorial review — it is never automatically approved or published, and it
        never modifies the canonical Recording.
      </p>
      {eligibleRecordings.length === 0 ? (
        <p>No published recordings are eligible for editorial generation yet.</p>
      ) : (
        <form action={generateEditorialSuggestionAction} style={{ display: "flex", gap: "0.5rem", maxWidth: "32rem", marginBottom: "1.5rem" }}>
          <select name="recordingId" required style={{ flex: 1 }}>
            {eligibleRecordings.map((recording) => {
              const count = suggestionCountByRecordingId.get(recording.id) ?? 0;
              return (
                <option key={recording.id} value={recording.id}>
                  {recordingLabel(recording)}
                  {count > 0 ? ` — ${count} existing suggestion${count === 1 ? "" : "s"}` : ""}
                </option>
              );
            })}
          </select>
          <button type="submit">Generate editorial suggestion</button>
        </form>
      )}

      <h2>All suggestions</h2>
      <form method="get" style={{ margin: "1rem 0", display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-end" }}>
        <label>
          Status
          <select name="status" defaultValue={status ?? ""} style={{ display: "block" }}>
            <option value="">All</option>
            {STATUS_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select name="suggestionType" defaultValue={suggestionType ?? ""} style={{ display: "block" }}>
            <option value="">All</option>
            {TYPE_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Filter</button>
        <Link href="/studio/content-suggestions">Clear</Link>
      </form>

      {suggestions.length === 0 ? (
        <p>No Content Suggestions match these filters.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Created</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Type</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Target</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Status</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Reviewer</th>
            </tr>
          </thead>
          <tbody>
            {suggestions.map((suggestion) => (
              <tr key={suggestion.id}>
                <td style={{ borderBottom: "1px solid #eee", padding: "0.25rem 0" }}>{formatAuditTimestamp(suggestion.createdAt)}</td>
                <td style={{ borderBottom: "1px solid #eee" }}>{suggestion.suggestionType}</td>
                <td style={{ borderBottom: "1px solid #eee" }}>
                  {suggestion.targetEntityType === "RECORDING"
                    ? `Recording — ${recordingTitles.get(suggestion.targetEntityId) ?? "(Recording no longer available)"}`
                    : suggestion.targetEntityType}
                </td>
                <td style={{ borderBottom: "1px solid #eee" }}>
                  <Link href={`/studio/content-suggestions/${suggestion.id}`}>{suggestion.status}</Link>
                </td>
                <td style={{ borderBottom: "1px solid #eee" }}>{suggestion.reviewedBy ? suggestion.reviewedBy.name : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
