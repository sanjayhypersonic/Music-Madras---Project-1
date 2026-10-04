"use client";

import { useActionState } from "react";
import { requestResetAction, type RequestResetFormState } from "./actions";

const initialState: RequestResetFormState = {};

export default function RequestPasswordResetPage() {
  const [state, formAction, pending] = useActionState(requestResetAction, initialState);

  if (state.submitted) {
    return <p>If an account exists for that email, a reset link has been sent.</p>;
  }

  return (
    <div className="studio-auth">
      <h1>Reset your password</h1>
      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" style={{ display: "block", width: "100%" }} />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send reset link"}
        </button>
      </form>
    </div>
  );
}
