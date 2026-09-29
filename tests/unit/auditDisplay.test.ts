import { describe, expect, it } from "vitest";
import { deriveAuditEntityLabel, formatAuditActionSummary, formatAuditTimestamp } from "../../modules/audit/auditDisplay";

describe("deriveAuditEntityLabel", () => {
  it("prefers the afterSnapshot name", () => {
    expect(
      deriveAuditEntityLabel({
        entityId: "abc-123",
        beforeSnapshot: { name: "Old Name" },
        afterSnapshot: { name: "New Name" },
      })
    ).toBe("New Name");
  });

  it("falls back to afterSnapshot title when no name is present", () => {
    expect(
      deriveAuditEntityLabel({ entityId: "abc-123", afterSnapshot: { title: "A Recording Title" } })
    ).toBe("A Recording Title");
  });

  it("falls back to beforeSnapshot when afterSnapshot has neither name nor title", () => {
    expect(
      deriveAuditEntityLabel({
        entityId: "abc-123",
        beforeSnapshot: { name: "Archived Name" },
        afterSnapshot: {},
      })
    ).toBe("Archived Name");
  });

  it("falls back to a shortened entityId when no snapshot has a label", () => {
    expect(deriveAuditEntityLabel({ entityId: "0123456789abcdef" })).toBe("01234567…");
  });

  it("returns the full entityId unshortened when it is already short", () => {
    expect(deriveAuditEntityLabel({ entityId: "short-id" })).toBe("short-id");
  });
});

describe("formatAuditActionSummary", () => {
  it("formats a two-word action", () => {
    expect(formatAuditActionSummary("COMPOSER_CREATED")).toBe("Composer created");
  });

  it("formats a three-word action", () => {
    expect(formatAuditActionSummary("OCCASION_ATTACHED_TO")).toBe("Occasion attached to");
  });

  it("returns a single-word action capitalized", () => {
    expect(formatAuditActionSummary("ARCHIVED")).toBe("Archived");
  });
});

describe("formatAuditTimestamp", () => {
  it("formats a Date into a readable date/time string", () => {
    const result = formatAuditTimestamp(new Date("2026-01-15T10:30:00.000Z"));
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
