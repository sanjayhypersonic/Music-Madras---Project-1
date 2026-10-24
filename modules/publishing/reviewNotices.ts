// Confirmation messages for the Review & Publish step (launch workflow). A server action finishes by redirecting back to the page; until now only a REFUSAL had
// feedback (`?error=`), so a successful submit, publish, unpublish or hold looked like nothing happened. A success is reported with a short CODE in the URL
// (`?notice=PUBLISHED`), never with text: the page looks the code up here, so a crafted link can show nothing but one of these fixed sentences. PURE.

export const REVIEW_NOTICES = {
  SUBMITTED: "Submitted for editorial review. Nothing is public yet.",
  PUBLISHED: "Published. This version is now what visitors see.",
  UNPUBLISHED: "Unpublished. The recording is no longer on the public Museum; its history is kept.",
  RESTORED: "Restored to draft. It stays off the public Museum until it is published.",
  HOLD_SET: "The recording is on hold and withheld from the public Museum. Its publication state is unchanged.",
  HOLD_LIFTED: "The hold was lifted. Whether the recording is public now follows its publication state alone.",
} as const;

export type ReviewNoticeCode = keyof typeof REVIEW_NOTICES;

/** The sentence for a code from the URL, or null for anything that is not one of ours. */
export function reviewNoticeText(value: string | undefined | null): string | null {
  if (!value || !Object.prototype.hasOwnProperty.call(REVIEW_NOTICES, value)) return null;
  return REVIEW_NOTICES[value as ReviewNoticeCode];
}
