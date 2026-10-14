import { describe, expect, it } from "vitest";

import { csvDate, csvFilename, escapeCsvCell, toCsv } from "./csv";

describe("escapeCsvCell", () => {
  it("stops text from running as a formula (S-19)", () => {
    expect(escapeCsvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeCsvCell("+639171234567")).toBe("'+639171234567");
    expect(escapeCsvCell("-1+1")).toBe("'-1+1");
    expect(escapeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsvCell("\tcmd")).toBe("'\tcmd");
  });

  it("leaves real numbers alone, negative ones too", () => {
    expect(escapeCsvCell(-3)).toBe("-3");
    expect(escapeCsvCell(42)).toBe("42");
    expect(escapeCsvCell(Number.NaN)).toBe("");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(escapeCsvCell("Quezon City, Metro Manila")).toBe('"Quezon City, Metro Manila"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("writes empty, yes and no", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
    expect(escapeCsvCell(true)).toBe("yes");
    expect(escapeCsvCell(false)).toBe("no");
  });
});

describe("toCsv", () => {
  it("writes a header row, then one row per item", () => {
    const csv = toCsv(
      [
        { header: "id", value: (r: { id: string; n: number }) => r.id },
        { header: "count", value: (r) => r.n },
      ],
      [
        { id: "a", n: 1 },
        { id: "b", n: 2 },
      ],
    );
    expect(csv).toBe("id,count\r\na,1\r\nb,2");
  });
});

describe("file names and dates", () => {
  it("dates in Manila", () => {
    // 20:00 UTC on the 13th is 04:00 on the 14th in Manila.
    const now = new Date("2026-10-13T20:00:00Z");
    expect(csvFilename("users", now)).toBe("linara-users-2026-10-14.csv");
    expect(csvDate("2026-10-13T20:00:00Z")).toBe("2026-10-14");
    expect(csvDate(null)).toBe("");
  });
});
