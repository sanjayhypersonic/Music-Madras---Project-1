# Runbook: scheduled maintenance (lifecycle checks, unlisted-video review, playlist checks, email delivery)

Status: **the entry point exists and is tested; no scheduler has been configured, because hosting has not been selected.** Until a scheduler calls it, queued notification emails are never sent, and the checks below run only when a signed-in person opens a Studio page. Nothing in this runbook chooses or configures infrastructure; Studio → **Health** shows what any scheduler has actually done.

## What the scheduled job does

`GET` or `POST /api/cron/stewardship` runs five independent, idempotent steps, in this order (one failing never stops the others):

1. **Approval lifecycle check** — ends any approval still standing on an archived page or a private video (a safety net behind the transition rules; see `docs/runbooks/approval-lifecycle-and-metadata-review.md`).
2. **Metadata review check** — notices material changes to approved videos' details, and records the baseline of pages approved before this existed.
3. **Unlisted-video review** — refreshes the review queue, its single notification, and the carried-over and metadata-review reminders.
4. **Playlist checks** — re-checks every published playlist page against its **published** snapshot, and the standing "cannot be published yet" notifications (so a changed setting resolves or reopens them).
5. **Email delivery** — sends the queued notification emails through the configured provider (`EMAIL_PROVIDER=smtp`, `SMTP_URL`, `EMAIL_FROM`), with a claim per delivery, bounded retries, honest statuses, and a delivery-problem notification for administrators.

The sweeps work in bounded batches in a stable order, each batch its own short transaction, so no catalogue size can run into a transaction's time limit. The response is counts only (no addresses, titles, error text or secrets).

### How it is protected from overlapping itself

A named **lease** (10 minutes, extended between steps) lets exactly one invocation run at a time. An invocation that arrives while another holds the lease does **nothing** and answers `200 {"ok":true,"ran":false,"skipped":"ALREADY_RUNNING"}`: that is not a failure. A run that crashed leaves a lease that simply expires, and the next run closes the crashed run's record as **abandoned**. If a run ever loses its lease part-way it stops starting steps and records the rest as skipped.

### What the response means

| Response | Meaning |
|---|---|
| `200`, `ran: true`, every step `SUCCEEDED` | Everything worked. |
| `200`, `ran: false`, `skipped: ALREADY_RUNNING` | Another run holds the lease; nothing was done and nothing is wrong. |
| `500`, `status: PARTIAL` | At least one step did not fully succeed (it failed, did only part of its work, or was skipped). The run is recorded; **the next invocation retries what is left**. |
| `500`, `status: FAILED` | Every step failed. |
| `500`, `ran: false` | The run could not even be recorded (a database problem). |
| `401` / `503` | Wrong or missing credentials / `CRON_SECRET` not configured. |

A completed HTTP request is never reported as success unless every step succeeded. Point your scheduler's alerting at **non-2xx responses**; Studio → Health is the second line.

## Authentication

Set `CRON_SECRET` on the deployment: at least 32 random characters. Any scheduler calls the endpoint with `Authorization: Bearer <CRON_SECRET>`.

- Unset or shorter than 32 characters → the endpoint is **disabled** (HTTP 503) and runs nothing. Production start-up also refuses a too-short value and warns when it is unset.
- Missing or wrong credentials → HTTP 401, no detail. The comparison is constant-time. The secret is never logged or returned.
- The route is excluded from crawling (`/api` is disallowed in `robots.txt`) and responses are `Cache-Control: no-store`.

Generate a value with any secure generator and store it only in the deployment's secret store, never in the repository.

## How often

| Concern | Needed cadence |
|---|---|
| Email delivery | every few minutes (a queued email should not wait; retries back off 1 min → 2 min, capped at 1 h) |
| Lifecycle, metadata, review and playlist checks | hourly is plenty (reminders are at most one per `unlistedReview.cadenceDays`) |

One schedule every 5–15 minutes covers all of it. Overlapping runs are safe (see above). Studio's own "run when a page is opened" refresh also runs the first four steps, throttled, but keeps no record and sends no email.

**Duration.** Each run bounds the time the sweeps may keep starting new batches (40 seconds); the email step still runs after them. Whatever platform runs the scheduler must allow a request of at least a minute; this is a hosting decision and is not made here.

## What is recorded, and where to look

Every run and step is stored (`stewardship_runs`, `stewardship_step_runs`): status, start and finish, counts, and — for a problem — an error class and a **scrubbed** one-line reason (connection strings, addresses, tokens and credentials are removed before anything is stored or logged). The newest 500 runs are kept.

**Studio → Health** (Super Administrators and Founders) shows: when the job last started and when every step last succeeded; each step's latest result and how many runs in a row it has not succeeded; whether a run is in progress now; a red notice if the job has **never run** or last started **more than three hours ago** (the schedule has probably stopped); emails waiting and in flight; and whether any approval stands on an archived page or private video. A step that fails **two runs in a row** also raises one administrator notification (resolved when it next succeeds); a single transient failure is shown in Health but interrupts nobody.

## Verifying it works (after a scheduler is configured)

1. Call it once by hand (placeholder values):
   ```bash
   curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<studio-host>/api/cron/stewardship
   ```
   Expect HTTP 200 and five steps with status `SUCCEEDED`. A 503 means `CRON_SECRET` is missing or too short; a 401 means the wrong value.
2. Studio → Health shows that run, every step, and "last run in which every step succeeded".
3. Call it twice at the same moment: exactly one runs, the other answers `ALREADY_RUNNING`.
4. Studio → Notifications (administrators): "The delivery job last tried to send on …" appears, and "waiting to be sent" drains.

## What the e-mail statuses mean

- **Queued / waiting to be sent** — a row exists; nothing has been sent.
- **Being sent** — a worker holds a live claim on it right now.
- **Accepted by the mail service** (stored as `DELIVERED`) — the mail service took the message. It does **not** prove it reached an inbox or was read.
- **Skipped** — nothing was sent, with the reason: email is not configured, email was switched off after queueing, the notification was resolved first, or the person no longer has access.
- **Failed** — the mail service rejected it three times; administrators get a notification. The delivery keeps a one-line reason made only of the transport's own short codes (for example `EAUTH 535`); the message text, which can contain credentials, is never stored.

### Delivery is at-least-once, never exactly-once

A delivery is **claimed** (5 minutes) before it is sent, and only the holder of the claim may record the outcome, so overlapping workers do not send a delivery twice, and re-raising a notification never deletes or invalidates a claim. If the mail service **accepts** a message and the database then cannot record that, the worker retries the write, and if it still cannot it logs the fact loudly and the delivery is **sent again** once its claim expires. A person can therefore, rarely, receive the same message twice. Links in e-mails are absolute and built only from a valid `AUTH_URL` (https, or loopback http); without one the e-mail says where to look instead of carrying a malformed link.

## Choosing a trigger (not decided here)

The job is hosting-neutral. Any of these can call it; pick according to where the site is hosted and verify that provider's schedule-frequency limits, maximum request duration and authentication options before relying on them:

- a hosting platform's built-in scheduled HTTP call (ADR-0001 proposed this shape: Scheduler → `/api/cron/*` → job);
- an external scheduling service that can send an HTTP request with a custom `Authorization` header;
- a small always-on worker or an operator's machine calling the URL (acceptable only as a stopgap).

## Not done

No scheduler, no hosting choice, no monitoring or alerting service. Studio → Health reports what ran; alerting on a stopped or failing schedule from outside the application is the deployment's to add.
