import { after } from "next/server";

// Phase 6J-1 — runs work AFTER the HTTP response has been sent, so how long a
// request takes cannot reveal whether an account exists (a password-reset
// request for a real account creates a token and sends an email; one for an
// unknown address does nothing). Outside a Next.js request (a test, a script)
// `after` is unavailable and the task simply runs inline, so callers can
// `await` the result either way.
export function runAfterResponse(task: () => Promise<void>): Promise<void> | void {
  try {
    after(task);
    return;
  } catch {
    return task();
  }
}
