import { describe, expect, it } from "vitest";

import { totp } from "../../e2e/totp";

// RFC 6238, Appendix B, SHA-1 vectors (6-digit truncation of the 8-digit values).
// Secret: ASCII "12345678901234567890" in base32.
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totp (for browser tests that sign in)", () => {
  it("matches the RFC 6238 vectors", () => {
    expect(totp(SECRET, 59)).toBe("287082");
    expect(totp(SECRET, 1111111109)).toBe("081804");
    expect(totp(SECRET, 1234567890)).toBe("005924");
  });

  it("ignores spaces and case in the secret", () => {
    expect(totp(SECRET.toLowerCase().replace(/(.{4})/g, "$1 "), 59)).toBe("287082");
  });
});
