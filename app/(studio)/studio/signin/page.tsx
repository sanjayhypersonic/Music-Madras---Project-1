"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInAction, type SignInFormState } from "./actions";

const initialState: SignInFormState = {};

export default function StudioSignInPage() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);

  return (
    <div style={{ maxWidth: "24rem" }}>
      <h1>Sign in</h1>
      <p>Music Madras Studio is invite-only. There is no self-registration.</p>
      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            style={{ display: "block", width: "100%" }}
          />
        </label>
        {state.error && <p style={{ color: "#b00020" }}>{state.error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p>
        <Link href="/studio/reset-password">Forgot your password?</Link>
      </p>
    </div>
  );
}
