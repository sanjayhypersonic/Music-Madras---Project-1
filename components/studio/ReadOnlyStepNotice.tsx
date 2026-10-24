import type { ReactNode } from "react";

// Shown on a Recording step whose forms are withheld from the signed-in role, so the absence of a form is explained rather than silent. It only describes: the
// server action behind the form checks the permission itself, whatever this page showed.
export function ReadOnlyStepNotice({ roles, what }: { roles: ReactNode; what: string }) {
  return (
    <p role="note" className="studio-muted">
      You can view this step but not change it. Only {roles} can {what}.
    </p>
  );
}
