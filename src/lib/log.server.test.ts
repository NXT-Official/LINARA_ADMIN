import { describe, expect, it } from "vitest";

import { scrub } from "./log.server";

describe("scrub", () => {
  it("removes emails, Philippine phone numbers and peso amounts (S-21)", () => {
    expect(scrub("mail ana@x.com or 09171234567, +639171234567, ₱6,500.00")).toBe(
      "mail [email] or [phone], [phone], [amount]",
    );
  });

  it("leaves ids and plain text alone", () => {
    expect(scrub("user 00000000-0000-0000-0000-00000000000a failed")).toBe(
      "user 00000000-0000-0000-0000-00000000000a failed",
    );
  });
});
