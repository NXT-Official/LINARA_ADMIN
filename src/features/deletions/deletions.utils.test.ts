import { describe, expect, it } from "vitest";

import { describeDeletion } from "./deletions.utils";

describe("describeDeletion (FR-DL-4)", () => {
  it("names what went with the account", () => {
    expect(describeDeletion("Mona", { user_id: "u1", household_deleted: false })).toBe(
      "Deleted Mona's account.",
    );
    expect(
      describeDeletion("Mona", {
        household_deleted: true,
        households_deleted: ["h1", "h2"],
        households_cleared: ["h1", "h2"],
      }),
    ).toBe(
      "Deleted Mona's account. 2 households they were the last manager of were deleted with it.",
    );
    expect(describeDeletion("Lito", { households_cleared: ["h1"], households_deleted: [] })).toBe(
      "Deleted Lito's account. 1 household they were the last manager of was cleared; it stays because its employment records do.",
    );
    expect(describeDeletion("Hana", { private_notes_deleted: 3 })).toBe(
      "Deleted Hana's account. 3 private notes were deleted.",
    );
  });

  it("says when the account was already gone", () => {
    expect(describeDeletion(null, { account_missing: true })).toBe(
      "The account was already gone. The request is closed.",
    );
  });
});
