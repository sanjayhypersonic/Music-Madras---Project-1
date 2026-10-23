import { describe, expect, it } from "vitest";
import {
  INCIDENT_LIMITS,
  IncidentInputError,
  NOTIFY_WINDOW_SECONDS,
  RECURRENCE_THRESHOLD,
  UNSPECIFIED_REASON,
  buildIncidentNotificationText,
  cleanIncident,
  incidentFingerprint,
  incidentNotificationKey,
  recurringSetFingerprint,
} from "../../modules/mmke/operations/operationalIncidents";
import { can } from "../../modules/auth/policy";
import { NOTIFICATION_KINDS, isNotificationKind } from "../../modules/notifications/notificationKinds";

// Operational incidents (R-15, first slice) — the pure rules. The point of most of these: NOTHING FREE-FORM can be stored or shown.

const KIND = "ORGANISATION_PAGE_RECORDING_OMITTED";
const RECORDING_ID = "6f1d2a40-3b7e-4c1a-9a55-0d2f8e6b1c11";

describe("what may be stored", () => {
  it("accepts a bounded reason code and a typed subject unchanged", () => {
    expect(cleanIncident({ kind: KIND, reasonCode: "PUBLISHED_REVISION_NOT_PUBLISHED", subject: { type: "Recording", id: RECORDING_ID } })).toEqual({
      kind: KIND,
      reasonCode: "PUBLISHED_REVISION_NOT_PUBLISHED",
      subjectType: "Recording",
      subjectId: RECORDING_ID,
    });
    expect(cleanIncident({ kind: KIND, reasonCode: "SOME_CODE" })).toMatchObject({ subjectType: null, subjectId: null });
  });

  it.each([
    ["exception text", "connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"],
    ["a sentence", "The recording could not be loaded"],
    ["lower case", "published_revision_missing"],
    ["a URL", "https://evil.example/x?token=abc"],
    ["an e-mail address", "someone@example.test"],
    ["markup", "<script>alert(1)</script>"],
    ["empty", ""],
    ["too long", "A".repeat(INCIDENT_LIMITS.reasonCode + 1)],
  ])("replaces a reason that is %s with a fixed code, never keeping any of it", (_name, reason) => {
    const clean = cleanIncident({ kind: KIND, reasonCode: reason });
    expect(clean.reasonCode).toBe(UNSPECIFIED_REASON);
    expect(JSON.stringify(clean)).not.toMatch(/hunter2|evil|someone|script|ECONNREFUSED/);
  });

  it.each([
    ["a URL as the id", { type: "Recording", id: "https://evil.example/x" }],
    ["spaces in the id", { type: "Recording", id: "a b" }],
    ["an id that is too long", { type: "Recording", id: "a".repeat(INCIDENT_LIMITS.subjectId + 1) }],
    ["text as the type", { type: "A recording of Bach", id: RECORDING_ID }],
    ["a type that is too long", { type: "R".repeat(INCIDENT_LIMITS.subjectType + 1), id: RECORDING_ID }],
    ["an empty id", { type: "Recording", id: "" }],
  ])("drops a subject with %s entirely (the incident is still recorded, without it)", (_name, subject) => {
    expect(cleanIncident({ kind: KIND, reasonCode: "CODE", subject })).toMatchObject({ subjectType: null, subjectId: null });
  });

  it("refuses a kind that is not in the closed list", () => {
    expect(() => cleanIncident({ kind: "ANYTHING_ELSE", reasonCode: "CODE" })).toThrow(IncidentInputError);
    expect(() => cleanIncident({ kind: "", reasonCode: "CODE" })).toThrow(IncidentInputError);
  });
});

describe("fingerprints identify one problem", () => {
  const base = cleanIncident({ kind: KIND, reasonCode: "CODE", subject: { type: "Recording", id: RECORDING_ID } });

  it("is stable for the same problem and differs for a different reason or subject", () => {
    expect(incidentFingerprint(base)).toBe(incidentFingerprint({ ...base }));
    expect(incidentFingerprint(base)).toMatch(/^[0-9a-f]{32}$/);
    expect(incidentFingerprint({ ...base, reasonCode: "OTHER" })).not.toBe(incidentFingerprint(base));
    expect(incidentFingerprint({ ...base, subjectId: "another-recording" })).not.toBe(incidentFingerprint(base));
    expect(incidentFingerprint({ ...base, subjectType: null, subjectId: null })).not.toBe(incidentFingerprint(base));
  });

  it("cannot be confused by values that merely concatenate to the same text", () => {
    const a = { ...base, reasonCode: "AB", subjectType: "C", subjectId: "D" };
    const b = { ...base, reasonCode: "A", subjectType: "BC", subjectId: "D" };
    expect(incidentFingerprint(a)).not.toBe(incidentFingerprint(b));
  });
});

describe("the recurring-incident notification", () => {
  it("has its own kind, visible only to those who may manage settings (Super Administrators and Founders)", () => {
    expect(isNotificationKind("OPERATIONAL_INCIDENT_RECURRING")).toBe(true);
    expect(NOTIFICATION_KINDS.OPERATIONAL_INCIDENT_RECURRING.audienceAction).toBe("SETTINGS_MANAGE");
    for (const role of ["FOUNDER", "SUPER_ADMINISTRATOR"] as const) expect(can(role, "SETTINGS_MANAGE"), role).toBe(true);
    for (const role of ["ADMINISTRATOR", "EDITOR", "REVIEWER", "CONTRIBUTOR"] as const) expect(can(role, "SETTINGS_MANAGE"), role).toBe(false);
  });

  it("is keyed once per KIND, so a thousand recurring incidents are still one notification", () => {
    expect(incidentNotificationKey(KIND)).toBe("operational-incident-recurring-ORGANISATION_PAGE_RECORDING_OMITTED");
  });

  it("says counts only: no ids, no reason codes, nothing from the data", () => {
    const text = buildIncidentNotificationText(KIND, [{ id: "incident-id-1", occurrenceCount: 4 }, { id: "incident-id-2", occurrenceCount: 3 }]);
    expect(text.title.length).toBeLessThanOrEqual(160);
    expect(text.body.length).toBeLessThanOrEqual(2000);
    expect(text.body).toMatch(/2 distinct problems are open, with 7 occurrences/);
    expect(text.body).toMatch(/Studio → Health/);
    expect(`${text.title} ${text.body}`).not.toMatch(/incident-id|PUBLISHED_REVISION|[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(buildIncidentNotificationText(KIND, [{ id: "x", occurrenceCount: 2 }]).body).toMatch(/1 distinct problem is open, with 2 occurrences/);
  });

  it("is announced again only when the SET of recurring incidents changes, whatever order it is read in, never because a count rose", () => {
    const a = [{ id: "a", occurrenceCount: 2 }, { id: "b", occurrenceCount: 9 }];
    expect(recurringSetFingerprint(a)).toBe(recurringSetFingerprint([...a].reverse()));
    expect(recurringSetFingerprint(a)).toBe(recurringSetFingerprint([{ id: "a", occurrenceCount: 50 }, { id: "b", occurrenceCount: 90 }]));
    expect(recurringSetFingerprint(a)).not.toBe(recurringSetFingerprint([...a, { id: "c", occurrenceCount: 2 }]));
  });

  it("uses bounded, sensible thresholds (a single occurrence never interrupts anyone; evaluation is limited to once per window)", () => {
    expect(RECURRENCE_THRESHOLD).toBe(2);
    expect(NOTIFY_WINDOW_SECONDS).toBeGreaterThanOrEqual(600);
  });
});
