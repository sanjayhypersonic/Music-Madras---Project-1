"use client";

import { useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { MouseEvent, ReactNode } from "react";

// Phase 6J-1 — one small submit button for Studio forms that change what is
// live or who can sign in. It adds the two protections the V1 audit found
// missing, without changing the form's server action or its permission check:
//
//   - confirmation: when `confirmMessage` is given, an accessible dialog must be
//     accepted before the form submits (the server still enforces everything, so
//     this is a safeguard against a slip, not a security gate);
//   - double-submit protection: while the action is running the button is
//     disabled and shows `pendingLabel`, so a second click cannot post twice.
//
// Phase 6J-3B — the confirmation is now a real modal <dialog> in the Studio's own
// visual system instead of window.confirm(). showModal() gives focus containment,
// Escape-to-cancel and a labelled, announced dialog; focus returns to the button.
// Only the presentation changed: "Confirm" submits the very same form through the
// very same Server Action (requestSubmit with this button as the submitter), so
// permissions, server-side validation and audit logging are exactly as before.
//
// `tone="danger"` styles the button as a destructive/withdrawing action
// (Archive, Unpublish, Revoke, Disable); `tone="primary"` as the main action.

export function ConfirmSubmitButton({
  children,
  confirmMessage,
  pendingLabel = "Working…",
  tone,
}: {
  children: ReactNode;
  confirmMessage?: string;
  pendingLabel?: string;
  tone?: "primary" | "danger";
}) {
  const { pending } = useFormStatus();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();

  function onClick(event: MouseEvent<HTMLButtonElement>) {
    if (pending) {
      event.preventDefault();
      return;
    }
    if (!confirmMessage) return;
    event.preventDefault();
    dialogRef.current?.showModal();
  }

  function confirm() {
    dialogRef.current?.close();
    // requestSubmit() does not fire a click on the button, so this cannot re-open the dialog.
    const button = buttonRef.current;
    button?.form?.requestSubmit(button);
  }

  function cancel() {
    dialogRef.current?.close();
    buttonRef.current?.focus();
  }

  const className = tone === "primary" ? "studio-button--primary" : tone === "danger" ? "studio-button--danger" : undefined;

  return (
    <>
      <button ref={buttonRef} type="submit" className={className} disabled={pending} aria-disabled={pending} onClick={onClick}>
        {pending ? pendingLabel : children}
      </button>
      {confirmMessage && (
        <dialog ref={dialogRef} className="studio-dialog" aria-labelledby={titleId} aria-describedby={messageId} onCancel={cancel}>
          <h2 id={titleId}>Please confirm</h2>
          <p id={messageId}>{confirmMessage}</p>
          <div className="studio-dialog__actions">
            <button type="button" onClick={cancel}>
              Cancel
            </button>
            <button type="button" className={tone === "danger" ? "studio-button--danger" : "studio-button--primary"} onClick={confirm}>
              Confirm
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}
