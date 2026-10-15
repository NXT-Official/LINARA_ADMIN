import { describe, expect, it } from "vitest";

import {
  normalisePhone,
  normaliseTags,
  parseActivityInput,
  parseFollowUpInput,
  parseLeadInput,
} from "./crm.input";

const NOW = new Date("2026-10-15T04:00:00Z");
const fails = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string; publicMessage?: string }).publicMessage ?? "threw";
  }
  return null;
};

describe("normalisePhone", () => {
  it.each([
    ["09171234567", "09171234567"],
    ["0917 123 4567", "09171234567"],
    ["0917-123-4567", "09171234567"],
    ["+63 917 123 4567", "09171234567"],
    ["639171234567", "09171234567"],
    ["9171234567", null],
    ["0817 123 4567", null],
    ["0917 123", null],
    ["call me", null],
  ])("%s -> %s", (raw, want) => {
    expect(normalisePhone(raw)).toBe(want);
  });
});

describe("normaliseTags", () => {
  it("splits, trims and keeps the first spelling of each tag", () => {
    expect(normaliseTags(" OFW, Cebu ,ofw,, referral-Santos ")).toEqual([
      "OFW",
      "Cebu",
      "referral-Santos",
    ]);
    expect(normaliseTags(["OFW", " ofw ", "Davao"])).toEqual(["OFW", "Davao"]);
  });

  it("refuses odd characters, long tags and more than 10", () => {
    expect(fails(() => normaliseTags("good, bad!"))).toMatch(/letters/);
    expect(fails(() => normaliseTags("x".repeat(31)))).toMatch(/letters/);
    expect(fails(() => normaliseTags(Array.from({ length: 11 }, (_, i) => `t${i}`)))).toMatch(
      /10 tags/,
    );
  });
});

describe("parseLeadInput (FR-CRM-1, FR-CRM-2)", () => {
  it("cleans a good lead", () => {
    expect(
      parseLeadInput({
        fullName: "  Lia Santos ",
        email: " Lia@Example.COM ",
        phone: "+63 917 123 4567",
        source: "facebook",
        ownerId: null,
        tags: "OFW",
        note: "  met at the fair ",
      }),
    ).toEqual({
      fullName: "Lia Santos",
      email: "lia@example.com",
      phone: "09171234567",
      source: "facebook",
      ownerId: null,
      tags: ["OFW"],
      note: "met at the fair",
    });
  });

  it("a lead needs email or phone", () => {
    expect(fails(() => parseLeadInput({ fullName: "Lia", email: "", phone: "" }))).toMatch(
      /email or a phone/,
    );
  });

  it("refuses a bad name, email, phone, source or owner", () => {
    expect(fails(() => parseLeadInput({ fullName: " ", email: "a@b.co" }))).toMatch(/name/);
    expect(fails(() => parseLeadInput({ fullName: "x".repeat(121), email: "a@b.co" }))).toMatch(
      /name/,
    );
    expect(fails(() => parseLeadInput({ fullName: "Lia", email: "lia@" }))).toMatch(/email/);
    expect(fails(() => parseLeadInput({ fullName: "Lia", phone: "12345" }))).toMatch(/09/);
    expect(
      fails(() => parseLeadInput({ fullName: "Lia", email: "a@b.co", source: "tiktok" as never })),
    ).toMatch(/where/i);
    expect(
      fails(() => parseLeadInput({ fullName: "Lia", email: "a@b.co", ownerId: "me" })),
    ).toMatch(/owner/);
  });
});

describe("parseActivityInput (FR-CRM-7)", () => {
  it("future activity is refused", () => {
    expect(
      fails(() =>
        parseActivityInput({ kind: "call", body: "Hi", occurredAt: "2026-10-16T04:00:00Z" }, NOW),
      ),
    ).toMatch(/future/);
  });

  it("needs a known kind and a body up to 2,000 characters", () => {
    expect(
      fails(() =>
        parseActivityInput(
          { kind: "fax" as never, body: "Hi", occurredAt: NOW.toISOString() },
          NOW,
        ),
      ),
    ).toMatch(/kind/);
    expect(
      fails(() =>
        parseActivityInput({ kind: "call", body: " ", occurredAt: NOW.toISOString() }, NOW),
      ),
    ).toMatch(/what/i);
    expect(
      fails(() =>
        parseActivityInput(
          { kind: "call", body: "x".repeat(2001), occurredAt: NOW.toISOString() },
          NOW,
        ),
      ),
    ).toMatch(/2,000/);
  });
});

describe("parseFollowUpInput (FR-CRM-8)", () => {
  const assigneeId = "7f0c2a7e-1b2c-4d5e-8f90-123456789abc";
  it("a follow-up a year out is refused", () => {
    expect(
      fails(() =>
        parseFollowUpInput({ dueAt: "2027-10-20T00:00:00Z", note: "Call", assigneeId }, NOW),
      ),
    ).toMatch(/year/);
  });

  it("needs a note and an admin", () => {
    expect(
      fails(() => parseFollowUpInput({ dueAt: "2026-10-20T00:00:00Z", note: "", assigneeId }, NOW)),
    ).toMatch(/what to do/i);
    expect(
      fails(() =>
        parseFollowUpInput({ dueAt: "2026-10-20T00:00:00Z", note: "Call", assigneeId: "x" }, NOW),
      ),
    ).toMatch(/who/i);
  });
});
