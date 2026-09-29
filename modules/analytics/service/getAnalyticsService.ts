import { AnalyticsService } from "./analyticsService";
import { Ga4Adapter } from "../providers/ga4/ga4Adapter";

// Phase 6G-18 — the one place `AnalyticsService` is actually constructed
// and wired to its provider adapter(s), reading configuration from
// environment variables (never hard-coded, matching every other secret in
// this project — see .env.example). Phase 3 built the adapter and the
// service; this is the missing "connect it to a real config source"
// wiring the Phase 3 docs (docs/analytics-architecture.md §4) explicitly
// deferred to a later phase.
//
// GA4_MEASUREMENT_ID/GA4_API_SECRET have no real value anywhere in this
// repository or environment (see .env.example) — Ga4Adapter.send() is
// unconfigured-safe by construction (Phase 3): without both values, it
// returns { delivered: false, reason: "not_configured" } and never makes
// a network call. Real production analytics delivery requires a real GA4
// property's Measurement ID and a Measurement Protocol API secret to be
// supplied via the deployment's environment configuration — this project
// does not invent or guess at those values.
//
// A lazily-built module-level singleton: every caller wants the exact
// same configured instance, and re-constructing the adapter per call
// would be wasteful for no benefit.
let instance: AnalyticsService | null = null;

export function getAnalyticsService(): AnalyticsService {
  if (!instance) {
    instance = new AnalyticsService([
      new Ga4Adapter({
        measurementId: process.env.GA4_MEASUREMENT_ID || undefined,
        apiSecret: process.env.GA4_API_SECRET || undefined,
      }),
    ]);
  }
  return instance;
}
