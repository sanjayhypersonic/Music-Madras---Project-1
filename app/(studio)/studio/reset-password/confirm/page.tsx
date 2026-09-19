"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { confirmResetAction, type ConfirmResetFormState } from "./actions";

const initialState: ConfirmResetFormState = {};

export default function ConfirmPasswordResetPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmResetForm />
    </Suspense>
  );
}

function ConfirmResetForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [state, formAction, pending] = useActionState(confirmResetAction, initialState);

  if (!token) {
    return <p>This reset link is missing its token. Request a new one.</p>;
  }

  return (
    <div style={{ maxWidth: "24rem" }}>
      <h1>Choose a new password</h1>
      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <input type="hidden" name="token" value={token} />
        <label>
          New password
          <input name="password" type="password" required minLength={10} style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Confirm new password
          <input
            name="confirmPassword"
            type="password"
            required
            minLength={10}
            style={{ display: "block", width: "100%" }}
          />
        </label>
        {state.error && <p style={{ color: "#b00020" }}>{state.error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save new password"}
        </button>
      </form>
    </div>
  );
}
