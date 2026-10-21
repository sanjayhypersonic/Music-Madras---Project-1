import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// Lifecycle hardening, F18 — what Studio SAYS about approvals, holds and roles must be true. These pages are server components that need a signed-in
// session and a database, so the wording is pinned at the source: each sentence below is a claim that was wrong, missing or misleading before, and a
// reviewer who changes the behaviour must change the sentence (and this test) with it. The behaviour itself is proved in the integration tests.

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const videoPage = read("app/(studio)/studio/(protected)/catalogue/videos/[videoId]/page.tsx");
const reviewPage = read("app/(studio)/studio/(protected)/catalogue/unlisted-review/page.tsx");
const reviewActions = read("app/(studio)/studio/(protected)/catalogue/unlisted-review/actions.ts");
const healthPage = read("app/(studio)/studio/(protected)/health/page.tsx");

describe("approving an unlisted video says what is exposed", () => {
  it("states that the page shows the embedded player and a link to the YouTube address, and that the video stays unlisted on YouTube", () => {
    for (const source of [videoPage, reviewPage]) {
      expect(source).toMatch(/embedded player and a link to/);
      expect(source).toMatch(/YouTube address/);
    }
    expect(videoPage).toMatch(/The video stays unlisted on YouTube/);
    expect(reviewPage).toMatch(/Nothing you decide changes the video on YouTube/);
  });

  it("no longer claims that approval only lets 'anyone with the link' open a page without mentioning what the page reveals", () => {
    expect(videoPage).not.toMatch(/Anyone with the link will be able to open it\. It will not be listed/);
  });

  it("explains the lifecycle: an approval ends if the video becomes private or the page is archived, and a fresh one is needed", () => {
    expect(reviewPage).toMatch(/ends by itself if the video becomes private or its page is archived/);
    expect(videoPage).toMatch(/Restoring the page later does not bring an approval back/);
    expect(videoPage).toMatch(/no approval is restored/);
  });
});

describe("clearing a hold does not claim a fresh approval is always needed", () => {
  it("has a different confirmation for a public video (visible again at once), an unlisted one (needs a fresh approval) and anything else", () => {
    expect(videoPage).toMatch(/This video is public on YouTube, so it needs no approval: if its catalogue page is published it will be visible on the public Museum again immediately/);
    expect(videoPage).toMatch(/This unlisted video stays off the public Museum until someone approves it afresh|stays off the public Museum until someone approves it afresh/);
    expect(videoPage).toMatch(/clearHoldConfirm/);
    expect(videoPage).not.toMatch(/confirmMessage="Clear this hold\? Nothing is approved by clearing it: earlier approvals stay revoked and the video needs a fresh, explicit approval\."/);
    expect(reviewActions).toMatch(/a public video whose page is published is visible again/);
  });
});

describe("role wording comes from the policy, not from a guess", () => {
  it("names who may approve, hold and decide through describeRolesThatCan, never 'Only an Administrator'", () => {
    expect(videoPage).toMatch(/describeRolesThatCan\("RECORDING_PUBLISH"\)/);
    expect(reviewPage).toMatch(/describeRolesThatCan\("RECORDING_PUBLISH"\)/);
    expect(videoPage).not.toMatch(/Only an Administrator/);
  });
});

describe("the four approval states are shown, and the history names events as themselves", () => {
  it("shows the lifecycle status and the metadata review panel on the video page", () => {
    expect(videoPage).toMatch(/APPROVAL_STATUS_TEXT\[lifecycle\.status\]/);
    expect(videoPage).toMatch(/Metadata review/);
    expect(videoPage).toMatch(/I have reviewed this change/);
    expect(videoPage).toMatch(/approver not recorded|recorded no approver/);
  });

  it("uses the shared decision labels in the history (hold recorded / hold cleared are not 'decline' and 'request info')", () => {
    expect(reviewPage).toMatch(/decisionLabel\(r\.kind\)/);
    expect(reviewPage).not.toMatch(/r\.kind\.toLowerCase\(\)\.replace/);
  });

  it("the review queue shows approved videos whose metadata changed, that the page stays public, and who the approver was (or that none is recorded)", () => {
    expect(reviewPage).toMatch(/Approved videos whose metadata changed/);
    expect(reviewPage).toMatch(/stays public while an editor looks/);
    expect(reviewPage).toMatch(/recorded no approver/);
  });
});

describe("the Health page is honest about what it can and cannot see", () => {
  it("says what it reports, that it starts nothing, and that delivery is at-least-once", () => {
    expect(healthPage).toMatch(/this page only reports what that scheduler has actually run/);
    expect(healthPage).toMatch(/at-least-once/);
    expect(healthPage).toMatch(/The job has never run/);
    expect(healthPage).toMatch(/probably stopped/);
  });
});
