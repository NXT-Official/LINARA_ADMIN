import { createHmac } from "node:crypto";

/**
 * A 6-digit authenticator code (RFC 6238: SHA-1, 30-second steps), so browser
 * tests can sign in as the test admin. Test-only; the console never makes codes.
 */
export function totp(secretBase32: string, atSeconds: number = Date.now() / 1000): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = secretBase32.toUpperCase().replace(/[\s=]/g, "");
  let bits = "";
  for (const ch of clean) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error("The TOTP secret isn't valid base32.");
    bits += v.toString(2).padStart(5, "0");
  }
  const key = Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, i) =>
      parseInt(bits.slice(i * 8, i * 8 + 8), 2),
    ),
  );

  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atSeconds / 30)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}
