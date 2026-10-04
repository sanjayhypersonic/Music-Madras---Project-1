"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { acceptInviteAction, type AcceptInviteFormState } from "./actions";

const initialState: AcceptInviteFormState = {};

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  );
}

function AcceptInviteForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [state, formAction, pending] = useActionState(acceptInviteAction, initialState);

  if (!token) {
    return <p>This invitation link is missing its token. Ask whoever invited you to resend it.</p>;
  }

  return (
    <div className="studio-auth">
      <h1>Activate your Studio account</h1>
      <p>Choose a password to finish setting up your account.</p>
      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <input type="hidden" name="token" value={token} />
        <label>
          Password
          <input name="password" type="password" required minLength={10} style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Confirm password
          <input
            name="confirmPassword"
            type="password"
            required
            minLength={10}
            style={{ display: "block", width: "100%" }}
          />
        </label>
        {state.error && <p role="alert" className="studio-alert studio-alert--error">{state.error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? "Activating…" : "Activate account"}
        </button>
      </form>
    </div>
  );
}
