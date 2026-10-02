// Phase 6J-1 — baseline HTTP security headers for every response.
//
// What is set, and why it is safe for this application:
//   X-Content-Type-Options: nosniff          browsers must honour declared MIME types.
//   Referrer-Policy: strict-origin-when-cross-origin
//                                            no path/query leaks to other sites, and the
//                                            ORIGIN is still sent — which YouTube's embedded
//                                            player requires to play.
//   X-Frame-Options: DENY  +  CSP frame-ancestors 'none'
//                                            nobody can frame Studio or the Museum
//                                            (clickjacking). Our own YouTube <iframe> is
//                                            unaffected: these govern who frames US, not
//                                            what we embed.
//   CSP base-uri 'self', object-src 'none'   blocks <base> hijacking and plugin content.
//   Permissions-Policy                       camera/microphone/geolocation/payment/usb off.
//   Strict-Transport-Security (production only, 1 year, no includeSubDomains/preload —
//                                            those are irreversible commitments for the
//                                            whole domain that the operator should make
//                                            deliberately, not this code).
//
// What is deliberately NOT set: a script-restricting Content-Security-Policy
// (script-src/style-src/default-src). Next.js injects inline bootstrap scripts, the
// Museum has a pre-paint theme script, and YouTube's player loads third-party
// frames/scripts; a CSP that is not built around per-request nonces would either
// break the site or be so loose it protects nothing. Doing it properly (nonces,
// a report-only trial first) is a documented follow-up, not something to guess at
// here. `form-action` is also omitted: it can block the post-submit redirect of an
// OAuth sign-in in some browsers.

export interface HeaderRule {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

export function buildSecurityHeaders(env: Record<string, string | undefined> = process.env): HeaderRule[] {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ];
  if (env.NODE_ENV === "production") {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000" });
  }
  return [{ source: "/:path*", headers }];
}
