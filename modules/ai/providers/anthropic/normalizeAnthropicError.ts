import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  BadRequestError,
  RateLimitError,
  UnprocessableEntityError,
} from "@anthropic-ai/sdk";
import type { AIProviderErrorInfo } from "../../provider/aiProvider";

// Phase 6H-5 — the ONLY file in this codebase that imports `@anthropic-ai/sdk`
// error classes. Converts them into the provider-neutral AIProviderErrorInfo
// shape so nothing outside modules/ai/providers/anthropic/** ever needs to
// know an Anthropic-specific error class exists. Never includes a header,
// API key, or raw request/response body in the normalized message.

export function normalizeAnthropicError(err: unknown): AIProviderErrorInfo {
  if (err instanceof APIConnectionTimeoutError) {
    return { type: "TIMEOUT", message: "The request to the Anthropic API timed out.", retryable: true };
  }
  if (err instanceof AuthenticationError) {
    return { type: "AUTHENTICATION", message: "Anthropic rejected the API key.", retryable: false, status: err.status };
  }
  if (err instanceof RateLimitError) {
    return { type: "RATE_LIMIT", message: "Anthropic rate limit exceeded.", retryable: true, status: err.status };
  }
  if (err instanceof BadRequestError || err instanceof UnprocessableEntityError) {
    return { type: "INVALID_REQUEST", message: err.message, retryable: false, status: err.status };
  }
  if (err instanceof APIConnectionError) {
    return { type: "NETWORK", message: "Could not connect to the Anthropic API.", retryable: true };
  }
  if (err instanceof APIError) {
    const status = err.status ?? 0;
    const retryable = status >= 500 || status === 408 || status === 409 || status === 429;
    return { type: retryable ? "PROVIDER_ERROR" : "INVALID_REQUEST", message: err.message, retryable, status };
  }

  return {
    type: "UNKNOWN",
    message: err instanceof Error ? err.message : "Unknown Anthropic provider error.",
    retryable: false,
  };
}
