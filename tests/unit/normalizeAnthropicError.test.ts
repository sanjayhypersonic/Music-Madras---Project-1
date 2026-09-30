import { describe, expect, it } from "vitest";
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { normalizeAnthropicError } from "../../modules/ai/providers/anthropic/normalizeAnthropicError";

// Phase 6H-5 — normalizeAnthropicError is the ONLY place an Anthropic SDK
// error class is consulted outside the adapter itself; every other module
// sees only the provider-neutral AIProviderErrorInfo shape.

describe("normalizeAnthropicError", () => {
  it("normalizes AuthenticationError as non-retryable AUTHENTICATION with a generic message (never forwarding the provider's raw error text)", () => {
    const info = normalizeAnthropicError(new AuthenticationError(401, { type: "error" }, "invalid x-api-key", new Headers()));
    expect(info.type).toBe("AUTHENTICATION");
    expect(info.retryable).toBe(false);
    expect(info.status).toBe(401);
  });

  it("normalizes RateLimitError as retryable RATE_LIMIT", () => {
    const info = normalizeAnthropicError(new RateLimitError(429, { type: "error" }, "rate limited", new Headers()));
    expect(info.type).toBe("RATE_LIMIT");
    expect(info.retryable).toBe(true);
    expect(info.status).toBe(429);
  });

  it("normalizes BadRequestError as non-retryable INVALID_REQUEST", () => {
    const info = normalizeAnthropicError(new BadRequestError(400, { type: "error" }, "malformed request", new Headers()));
    expect(info.type).toBe("INVALID_REQUEST");
    expect(info.retryable).toBe(false);
  });

  it("normalizes APIConnectionTimeoutError as retryable TIMEOUT", () => {
    const info = normalizeAnthropicError(new APIConnectionTimeoutError());
    expect(info.type).toBe("TIMEOUT");
    expect(info.retryable).toBe(true);
  });

  it("normalizes a generic APIConnectionError as retryable NETWORK", () => {
    const info = normalizeAnthropicError(new APIConnectionError({ message: "network down" }));
    expect(info.type).toBe("NETWORK");
    expect(info.retryable).toBe(true);
  });

  it("normalizes InternalServerError (5xx) as retryable PROVIDER_ERROR", () => {
    const info = normalizeAnthropicError(new InternalServerError(500, { type: "error" }, "internal error", new Headers()));
    expect(info.type).toBe("PROVIDER_ERROR");
    expect(info.retryable).toBe(true);
    expect(info.status).toBe(500);
  });

  it("normalizes a non-Anthropic error as non-retryable UNKNOWN, never throwing itself", () => {
    const info = normalizeAnthropicError(new Error("something unrelated"));
    expect(info.type).toBe("UNKNOWN");
    expect(info.retryable).toBe(false);
    expect(info.message).toBe("something unrelated");
  });

  it("never includes an Authorization header, API key value, or raw headers object in the normalized message", () => {
    const secretKey = "sk-ant-super-secret-value";
    const headers = new Headers({ authorization: `Bearer ${secretKey}` });
    const info = normalizeAnthropicError(new AuthenticationError(401, { type: "error" }, "invalid x-api-key", headers));
    const serialized = JSON.stringify(info);
    expect(serialized).not.toContain(secretKey);
    expect(serialized).not.toContain("authorization");
  });
});
