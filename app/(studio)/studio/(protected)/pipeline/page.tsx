import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { can } from "../../../../../modules/auth/policy";
import { countPipelineByStatus, listPipelineBundles, listRecentPipelineRuns } from "../../../../../modules/db/repositories/pipelineRepository";
import { canBulkApprove } from "../../../../../modules/pipeline/approve";
import { readPipelineConfig } from "../../../../../modules/pipeline/config";
import { decodeMessage } from "../../../../../modules/studio/decodeMessage";
import { bulkApproveAction } from "./actions";

// R-34: the Pipeline inbox — one bundle per video, drafted by the upload-to-draft pipeline (docs/upload-pipeline.md). Nothing here is public
// until the owner approves a bundle. Bulk approval is offered only for bundles with no flags. RECORDING_PUBLISH only.

const STATUS_LABEL: Record<string, string> = { AWAITING_APPROVAL: "Awaiting approval", APPROVED: "Approved, not published", PUBLISHED: "Published", REJECTED: "Rejected", FAILED: "Failed", QUEUED: "Queued", EXTRACTED: "Extracted", RESOLVED: "Resolved", RESEARCHED: "Researched", SKIPPED: "Skipped" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string; status?: string }> }) {
  const { error, done, status } = await searchParams;
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE") redirect("/studio/signin");
  if (!can(session.user.role, "RECORDING_PUBLISH")) redirect("/studio/dashboard");

  const config = readPipelineConfig(process.env);
  const [bundles, counts, runs] = await Promise.all([listPipelineBundles({ status }), countPipelineByStatus(), listRecentPipelineRuns()]);

  return (
    <div>
      <h1>Pipeline</h1>
      <p className="studio-muted">
        New YouTube uploads, drafted into video and entity pages. Nothing is public until you approve a bundle; approval creates the DRAFT Recording and new entities through the usual services and publishes through the usual publish flow.
      </p>
      {!config.enabled && <p className="studio-alert studio-alert--info">The pipeline is switched off (PIPELINE_ENABLED is not true). Existing bundles can still be reviewed.</p>}
      {config.enabled && config.dryRun && <p className="studio-alert studio-alert--warning">The pipeline is in dry-run mode: it reports what it would do and calls no AI provider.</p>}
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeMessage(error)}</p>}
      {done && <p role="status" className="studio-alert studio-alert--success">{decodeMessage(done)}</p>}

      <p>
        {Object.entries(counts).map(([s, n], i) => (
          <span key={s}>
            {i > 0 && " · "}
            <Link href={`/studio/pipeline?status=${s}`}>{STATUS_LABEL[s] ?? s}</Link>: {n}
          </span>
        ))}
        {status && (
          <>
            {" · "}
            <Link href="/studio/pipeline">Show the inbox</Link>
          </>
        )}
      </p>

      <h2>Bundles</h2>
      {bundles.length === 0 ? (
        <p className="studio-empty">No bundles here.</p>
      ) : (
        <form action={bulkApproveAction}>
          <div className="studio-table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Bulk</th>
                  <th scope="col">Video</th>
                  <th scope="col">Status</th>
                  <th scope="col">Flags</th>
                  <th scope="col">Claims</th>
                  <th scope="col">AI cost</th>
                </tr>
              </thead>
              <tbody>
                {bundles.map((b) => {
                  const bulk = canBulkApprove(b);
                  return (
                    <tr key={b.id}>
                      <td>
                        <input type="checkbox" name="ids" value={b.id} disabled={!bulk} aria-label={bulk ? `Select ${b.youtubeVideo.title ?? b.youtubeVideo.youtubeVideoId} for bulk approval` : "Has flags: approve it on its own page"} />
                      </td>
                      <td>
                        <Link href={`/studio/pipeline/${b.id}`}>{b.youtubeVideo.title ?? b.youtubeVideo.youtubeVideoId}</Link>
                      </td>
                      <td>{STATUS_LABEL[b.status] ?? b.status}</td>
                      <td>{b.flags.length === 0 ? <span className="studio-badge studio-badge--success">none</span> : <span className="studio-badge studio-badge--warning">{b.flags.length}</span>}</td>
                      <td>{b._count.claims}</td>
                      <td>${Number(b.costUsd).toFixed(4)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p>
            <button type="submit" className="studio-button--primary">Approve and publish the selected bundles</button> <span className="studio-muted">Only bundles with no flags can be selected.</span>
          </p>
        </form>
      )}

      <h2>Recent runs</h2>
      {runs.length === 0 ? (
        <p className="studio-empty">No run recorded yet.</p>
      ) : (
        <ul>
          {runs.map((r) => (
            <li key={r.id}>
              {r.startedAt.toLocaleString()} — {r.status}
              {r.dryRun ? " (dry run)" : ""} · {r.videosAdvanced} stage(s) advanced · {r.inputTokens + r.outputTokens} tokens · {r.webSearches} searches · ${Number(r.costUsd).toFixed(4)} of ${Number(r.costCapUsd).toFixed(2)}
              {r.stoppedReason ? ` · stopped: ${r.stoppedReason}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
