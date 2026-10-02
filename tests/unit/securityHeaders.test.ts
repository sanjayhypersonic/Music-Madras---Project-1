import { describe, expect, it } from "vitest";
import { buildSecurityHeaders } from "../../modules/config/securityHeaders";
import { serializeJsonLd } from "../../modules/seo/serializeJsonLd";

const valueOf = (headers: ReturnType<typeof buildSecurityHeaders>, key: string) => headers[0].headers.find((h) => h.key === key)?.value;

describe("security headers (Phase 6J-1)", () => {
  const dev = buildSecurityHeaders({ NODE_ENV: "development" });
  const prod = buildSecurityHeaders({ NODE_ENV: "production" });

  it("applies to every route", () => {
    expect(dev).toHaveLength(1);
    expect(dev[0].source).toBe("/:path*");
  });

  it("prevents framing, MIME sniffing and referrer path leakage", () => {
    expect(valueOf(dev, "X-Frame-Options")).toBe("DENY");
    expect(valueOf(dev, "X-Content-Type-Options")).toBe("nosniff");
    expect(valueOf(dev, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(valueOf(dev, "Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("keeps YouTube embeds working: sends the origin as referrer and sets no script/frame/default-src restriction", () => {
    // YouTube's player needs an origin referrer; strict-origin-when-cross-origin provides it.
    expect(valueOf(dev, "Referrer-Policy")).not.toBe("no-referrer");
    const csp = valueOf(dev, "Content-Security-Policy")!;
    for (const directive of ["default-src", "script-src", "style-src", "frame-src", "child-src", "connect-src", "img-src", "form-action"]) {
      expect(csp).not.toContain(directive);
    }
    // And never blocks the features Studio or the Museum use.
    expect(valueOf(dev, "Permissions-Policy")).not.toMatch(/fullscreen|autoplay|encrypted-media/);
  });

  it("sends HSTS in production only", () => {
    expect(valueOf(dev, "Strict-Transport-Security")).toBeUndefined();
    expect(valueOf(prod, "Strict-Transport-Security")).toBe("max-age=31536000");
    expect(valueOf(prod, "Strict-Transport-Security")).not.toMatch(/includeSubDomains|preload/);
  });
});

describe("serializeJsonLd (Phase 6J-1)", () => {
  const HOSTILE = "</script><script>alert(1)</script><!-- & > <";

  it("can never terminate or reopen the script element, whatever the data contains", () => {
    const out = serializeJsonLd({ "@context": "https://schema.org", "@type": "Person", name: HOSTILE, description: `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c` });
    expect(out).not.toMatch(/<|>|&/);
    expect(out.toLowerCase()).not.toContain("</script");
    expect(out).not.toContain("<!--");
    expect(out).not.toContain(String.fromCharCode(0x2028));
    expect(out).not.toContain(String.fromCharCode(0x2029));
  });

  it("does not change the meaning of the JSON: parsing it returns exactly the original data", () => {
    const data = { "@context": "https://schema.org", "@type": "MusicComposition", name: HOSTILE, nested: { list: ["<b>x</b>", 'quote " and \\ backslash', "tamil: மங்களம்"], n: 3, ok: true, none: null } };
    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });

  it("leaves ordinary text untouched", () => {
    expect(serializeJsonLd({ name: "Handel: Messiah" })).toBe('{"name":"Handel: Messiah"}');
  });

  it("an HTML page built around the output stays safe (the hostile text cannot break out of the element)", () => {
    const page = `<script type="application/ld+json">${serializeJsonLd({ name: HOSTILE })}</script><p>after</p>`;
    // Exactly one script element opens and closes: the only closing tag is the one we wrote.
    expect(page.match(/<\/script/gi)).toHaveLength(1);
    expect(page.match(/<script/gi)).toHaveLength(1);
  });
});
