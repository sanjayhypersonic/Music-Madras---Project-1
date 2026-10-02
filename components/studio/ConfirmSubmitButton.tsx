"use client";

import { useFormStatus } from "react-dom";
import type { MouseEvent, ReactNode } from "react";

// Phase 6J-1 — one small submit button for Studio forms that change what is
// live or who can sign in. It adds the two protections the V1 audit found
// missing, without changing the form's server action or its permission check:
//
//   - confirmation: when `confirmMessage` is given, the browser's own
//     confirm() dialog must be accepted before the form submits (native,
//     keyboard- and screen-reader-accessible; the server still enforces
//     everything, so this is a safeguard against a slip, not a security gate);
//   - double-submit protection: while the action is running the button is
//     disabled and shows `pendingLabel`, so a second click cannot post twice.

export function ConfirmSubmitButton({
  children,
  confirmMessage,
  pendingLabel = "Working…",
}: {
  children: ReactNode;
  confirmMessage?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();

  function onClick(event: MouseEvent<HTMLButtonElement>) {
    if (pending) {
      event.preventDefault();
      return;
    }
    if (confirmMessage && !window.confirm(confirmMessage)) {
      event.preventDefault();
    }
  }

  return (
    <button type="submit" disabled={pending} aria-disabled={pending} onClick={onClick}>
      {pending ? pendingLabel : children}
    </button>
  );
}
