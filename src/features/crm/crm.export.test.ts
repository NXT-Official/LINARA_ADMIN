import { describe, expect, it } from "vitest";

import { listContacts } from "@/data/queries";
import { toCsv } from "@/lib/csv";

import { CONTACT_CSV } from "./crm.export";

describe("the one-click CRM export (FR-EX-1)", () => {
  const contacts = listContacts();
  const csv = toCsv(CONTACT_CSV, contacts);

  it("has a row for every contact", () => {
    expect(csv.split("\r\n")).toHaveLength(contacts.length + 1);
  });

  it("carries no name, email or phone", () => {
    for (const c of contacts) {
      expect(csv).not.toContain(c.fullName);
      if (c.email) expect(csv.toLowerCase()).not.toContain(c.email.toLowerCase());
      if (c.phone) expect(csv).not.toContain(c.phone);
    }
  });

  it("carries no activity or follow-up text", () => {
    for (const c of contacts) {
      for (const a of c.activities) expect(csv).not.toContain(a.body);
      for (const f of c.followUps) expect(csv).not.toContain(f.note);
    }
  });
});
