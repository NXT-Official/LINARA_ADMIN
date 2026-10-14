import { describe, expect, it } from "vitest";

import { renderErrorPage } from "./error-page";
import { SECURITY_HEADERS, buildCsp, withSecurityHeaders } from "./security-headers";

describe("buildCsp (S-14)", () => {
  const csp = buildCsp("abc");
  const directive = (name: string) =>
    csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith(`${name} `)) ?? "";

  it("allows scripts only from this site, the nonce and hCaptcha", () => {
    expect(directive("script-src")).toBe(
      "script-src 'self' 'nonce-abc' https://hcaptcha.com https://*.hcaptcha.com",
    );
    expect(directive("script-src")).not.toContain("unsafe-inline");
    expect(directive("script-src")).not.toContain("unsafe-eval");
  });

  it("forbids framing, plugins and foreign form targets", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("lets the browser reach only this site and hCaptcha", () => {
    expect(directive("connect-src")).toBe(
      "connect-src 'self' https://hcaptcha.com https://*.hcaptcha.com",
    );
  });

  it("allows the QR code's data image and Google Fonts", () => {
    expect(directive("img-src")).toBe("img-src 'self' data:");
    expect(directive("font-src")).toBe("font-src 'self' https://fonts.gstatic.com");
    expect(directive("style-src")).toContain("https://fonts.googleapis.com");
  });
});

describe("withSecurityHeaders with a nonce", () => {
  it("enforces the CSP in production and adds no-store", () => {
    const res = withSecurityHeaders(new Response(null), { nonce: "abc", noStore: true });
    expect(res.headers.get("content-security-policy")).toContain("'nonce-abc'");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("only reports CSP violations in development", () => {
    const res = withSecurityHeaders(new Response(null), { nonce: "abc", reportOnly: true });
    expect(res.headers.get("content-security-policy-report-only")).toContain("'nonce-abc'");
    expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
  });

  it("leaves caching alone for static assets", () => {
    const res = withSecurityHeaders(new Response(null), { nonce: "abc", noStore: false });
    expect(res.headers.get("cache-control")).toBeNull();
  });
});

describe("renderErrorPage", () => {
  it("has no inline script, so the CSP doesn't block it", () => {
    expect(renderErrorPage()).not.toMatch(/onclick|<script/i);
  });
});

describe("withSecurityHeaders", () => {
  it("adds the headers and keeps the response as it was", async () => {
    const res = withSecurityHeaders(
      new Response("<p>hi</p>", { status: 201, headers: { "content-type": "text/html" } }),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("text/html");
    expect(await res.text()).toBe("<p>hi</p>");
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers.get(name)).toBe(value);
    }
  });

  it("forbids framing by any other site", () => {
    const res = withSecurityHeaders(new Response(null));
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("keeps every response out of search engines", () => {
    const res = withSecurityHeaders(new Response(null));
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("leaves a header the response already set", () => {
    const res = withSecurityHeaders(
      new Response(null, { headers: { "referrer-policy": "no-referrer" } }),
    );
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("keeps a redirect a redirect", () => {
    const res = withSecurityHeaders(
      new Response(null, { status: 307, headers: { location: "/login" } }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/login");
  });
});
