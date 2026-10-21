import { resolveEmailProviderChoice } from "../auth/email/emailProvider";

// Phase 6K-1 — what is known about notification delivery configuration, for administrators. Uses the existing, pure email provider
// resolution, so it can never disagree with what the provider would actually do. It reports NAMES and states, never a value, and it
// cannot know whether credentials are valid or a message was received: "configured" means the deployment asks for real delivery and
// supplies what that needs.

export type EmailDeliveryState = "CONFIGURED" | "CONSOLE_ONLY" | "NOT_CONFIGURED";

export interface EmailDeliveryStatus {
  state: EmailDeliveryState;
  /** Safe to display: no value from the environment. */
  detail: string;
}

export function describeEmailDelivery(env: Record<string, string | undefined> = process.env): EmailDeliveryStatus {
  const choice = resolveEmailProviderChoice(env);
  if (choice.kind === "smtp") return { state: "CONFIGURED", detail: "SMTP delivery is configured in the deployment (credentials are not checked here)." };
  if (choice.kind === "console") return { state: "CONSOLE_ONLY", detail: "Email is not delivered: messages are only printed to the server console (development)." };
  return { state: "NOT_CONFIGURED", detail: choice.reason };
}
