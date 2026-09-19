import { describe, expect, it } from "vitest";
import { can, canManageUsers, type StudioAction } from "../../modules/auth/policy";
import type { StudioRoleName } from "../../modules/auth/types";

const ALL_ACTIONS: StudioAction[] = [
  "CATALOGUE_WRITE",
  "RECORDING_WRITE",
  "EDITORIAL_REVIEW",
  "RECORDING_PUBLISH",
  "USER_MANAGE",
  "SETTINGS_MANAGE",
  "AUDIT_VIEW",
];

describe("can", () => {
  it("Contributors can only write recording drafts (brief §22: no publish without an explicit grant)", () => {
    expect(can("CONTRIBUTOR", "RECORDING_WRITE")).toBe(true);
    for (const action of ALL_ACTIONS.filter((a) => a !== "RECORDING_WRITE")) {
      expect(can("CONTRIBUTOR", action)).toBe(false);
    }
  });

  it("Editors and Reviewers can move drafts through editorial review but never publish", () => {
    for (const role of ["EDITOR", "REVIEWER"] as StudioRoleName[]) {
      expect(can(role, "RECORDING_WRITE")).toBe(true);
      expect(can(role, "CATALOGUE_WRITE")).toBe(true);
      expect(can(role, "EDITORIAL_REVIEW")).toBe(true);
      expect(can(role, "RECORDING_PUBLISH")).toBe(false);
      expect(can(role, "USER_MANAGE")).toBe(false);
    }
  });

  it("Administrators can publish and view the audit log but cannot manage users or settings", () => {
    expect(can("ADMINISTRATOR", "RECORDING_PUBLISH")).toBe(true);
    expect(can("ADMINISTRATOR", "AUDIT_VIEW")).toBe(true);
    expect(can("ADMINISTRATOR", "USER_MANAGE")).toBe(false);
    expect(can("ADMINISTRATOR", "SETTINGS_MANAGE")).toBe(false);
  });

  it("Super Administrators and Founders hold every defined action", () => {
    for (const role of ["SUPER_ADMINISTRATOR", "FOUNDER"] as StudioRoleName[]) {
      for (const action of ALL_ACTIONS) {
        expect(can(role, action)).toBe(true);
      }
    }
  });
});

describe("canManageUsers", () => {
  it("is true only for the two roles holding USER_MANAGE", () => {
    expect(canManageUsers("SUPER_ADMINISTRATOR")).toBe(true);
    expect(canManageUsers("FOUNDER")).toBe(true);
    expect(canManageUsers("ADMINISTRATOR")).toBe(false);
    expect(canManageUsers("EDITOR")).toBe(false);
    expect(canManageUsers("REVIEWER")).toBe(false);
    expect(canManageUsers("CONTRIBUTOR")).toBe(false);
  });
});
