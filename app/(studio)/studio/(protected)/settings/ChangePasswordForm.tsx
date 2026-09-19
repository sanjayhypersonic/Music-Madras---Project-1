"use client";

import { useActionState } from "react";
import { changePasswordAction, type ChangePasswordFormState } from "./actions";

const initialState: ChangePasswordFormState = {};

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, initialState);

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}>
      <label>
        Current password
        <input name="currentPassword" type="password" required style={{ display: "block", width: "100%" }} />
      </label>
      <label>
        New password
        <input name="newPassword" type="password" required minLength={10} style={{ display: "block", width: "100%" }} />
      </label>
      <label>
        Confirm new password
        <input name="confirmPassword" type="password" required minLength={10} style={{ display: "block", width: "100%" }} />
      </label>
      {state.error && <p style={{ color: "#b00020" }}>{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </button>
      <p style={{ fontSize: "0.85rem" }}>Changing your password signs you out of every session, including this one.</p>
    </form>
  );
}
