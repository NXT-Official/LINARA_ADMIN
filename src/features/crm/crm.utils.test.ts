import { describe, expect, it } from "vitest";

import { contactFiltersFromSearch, contactHref } from "./crm.utils";

describe("contactFiltersFromSearch (FR-DB-8)", () => {
  it("keeps known filters from a dashboard link", () => {
    expect(contactFiltersFromSearch({ kind: "customer", stage: "at_risk", due: "today" })).toEqual({
      kind: "customer",
      stage: "at_risk",
      due: "today",
    });
  });

  it("drops anything it doesn't know", () => {
    expect(
      contactFiltersFromSearch({ kind: "partner", stage: "won", due: "soon", extra: "x" }),
    ).toEqual({});
    expect(contactFiltersFromSearch({ stage: 5 })).toEqual({});
  });
});

describe("contactHref", () => {
  it("a saved contact, or a manager's account page", () => {
    expect(contactHref({ contactId: "c1", userId: "u1" })).toBe("/crm/c1");
    expect(contactHref({ contactId: null, userId: "u1" })).toBe("/crm/account/u1");
  });
});
