import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AutosaveStepForm } from "../../app/(studio)/studio/_components/AutosaveStepForm";

// Phase 6J-10E — server-render sanity for the shared autosave form (no DOM in the unit environment, so effects,
// localStorage and event wiring are NOT exercised here; the lifecycle is covered by autosaveController.test.ts and
// the recovery store by autosaveRecovery.test.ts).

describe("AutosaveStepForm initial render", () => {
  const html = renderToString(
    createElement(AutosaveStepForm, {
      recordingId: "rec-1",
      revisionId: "rev-1",
      userId: "user-1",
      formId: "source",
      initialUpdatedAt: "2026-10-19T10:00:00.000Z",
      initialValues: { title: "A title", description: "A description" },
      fields: [
        { name: "title", label: "Title", type: "text" },
        { name: "description", label: "Description", type: "textarea" },
      ],
      saveAction: async () => ({ ok: true as const, updatedAt: "2026-10-19T10:00:01.000Z" }),
    })
  );

  it("renders the fields with the server's values and an editable form", () => {
    expect(html).toContain("A title");
    expect(html).toContain("A description");
    expect(html).toContain("Title");
    expect(html).not.toMatch(/readonly/i);
  });

  it("starts in a clean state: no recovery offer, no error, no retry controls, no 'saved' claim", () => {
    expect(html).not.toContain("Recover unsaved text");
    expect(html).not.toContain("Retry now");
    expect(html).not.toContain("Reload the latest version");
    expect(html).not.toMatch(/Not saved|Unsaved changes|Saving/);
    expect(html).not.toContain(">Saved<");
  });
});
