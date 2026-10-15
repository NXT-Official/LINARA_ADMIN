import { describe, expect, it } from "vitest";

import { buildImportRows, guessMapping, parseSource } from "./crm.import";

const HEADERS = ["Full name", "E-mail", "Mobile", "Where", "Labels", "Remarks"];

describe("guessMapping", () => {
  it("guesses common headers", () => {
    expect(guessMapping(HEADERS)).toEqual({
      fullName: 0,
      email: 1,
      phone: 2,
      source: 3,
      tags: 4,
      note: 5,
    });
    expect(guessMapping(["name", "phone number"])).toEqual({ fullName: 0, phone: 1 });
  });
});

describe("parseSource", () => {
  it("source labels and codes", () => {
    expect(parseSource("Facebook")).toBe("facebook");
    expect(parseSource("walk-in")).toBe("walk_in");
    expect(parseSource("Walk in")).toBe("walk_in");
    expect(parseSource("WEBSITE")).toBe("website");
    expect(parseSource("")).toBeNull();
    expect(parseSource("tiktok")).toBe("unknown");
  });
});

const mapping = guessMapping(HEADERS);
const table = (...rows: string[][]) => [HEADERS, ...rows];

describe("buildImportRows (FR-CRM-10)", () => {
  it("cleans good rows and numbers lines from the header", () => {
    const rows = buildImportRows(
      table([
        "Lia Santos",
        "LIA@example.com",
        "0917 123 4567",
        "Facebook",
        "OFW, Cebu",
        "Met at expo",
      ]),
      mapping,
      [],
    );
    expect(rows).toEqual([
      {
        line: 2,
        input: {
          fullName: "Lia Santos",
          email: "LIA@example.com",
          phone: "0917 123 4567",
          source: "facebook",
          tags: "OFW, Cebu",
          note: "Met at expo",
        },
        errors: [],
        duplicateOf: null,
        include: true,
      },
    ]);
  });

  it("reports the line of a bad row", () => {
    const rows = buildImportRows(
      table(["Lia", "", "", "", "", ""], ["Paolo", "p@example.com", "", "tiktok", "", ""]),
      mapping,
      [],
    );
    expect(rows[0]).toMatchObject({
      line: 2,
      errors: ["A lead needs an email or a phone number."],
    });
    expect(rows[1]).toMatchObject({ line: 3, errors: ["Pick a known source."] });
  });

  it("flags duplicates inside the file", () => {
    const rows = buildImportRows(
      table(
        ["Lia", "lia@example.com", "", "", "", ""],
        ["Lia S", "LIA@Example.com", "", "", "", ""],
        ["Paolo", "", "09180001111", "", "", ""],
        ["Paolo C", "", "+63 918 000 1111", "", "", ""],
      ),
      mapping,
      [],
    );
    expect(rows.map((r) => [r.duplicateOf, r.include])).toEqual([
      ["file", false],
      ["file", false],
      ["file", false],
      ["file", false],
    ]);
  });

  it("flags duplicates of saved contacts", () => {
    const rows = buildImportRows(
      table(["Lia", "lia@example.com", "", "", "", ""], ["New", "new@example.com", "", "", "", ""]),
      mapping,
      [{ email: "Lia@Example.com", phone: null }],
    );
    expect(rows.map((r) => [r.duplicateOf, r.include])).toEqual([
      ["saved", false],
      [null, true],
    ]);
  });

  it("formula cells are neutralised", () => {
    const [row] = buildImportRows(
      table(['=HYPERLINK("x")', "a@example.com", "", "", "", "@SUM(1)"]),
      mapping,
      [],
    );
    expect(row.input.fullName).toBe('\'=HYPERLINK("x")');
    expect(row.input.note).toBe("'@SUM(1)");
  });

  it("501 rows is refused", () => {
    const many = Array.from({ length: 501 }, (_, i) => [
      `P${i}`,
      `p${i}@example.com`,
      "",
      "",
      "",
      "",
    ]);
    expect(() => buildImportRows(table(...many), mapping, [])).toThrow(/500/);
  });

  it("a row with nothing in it is skipped", () => {
    const rows = buildImportRows(
      table(["", "", "", "", "", ""], ["Lia", "lia@example.com", "", "", "", ""]),
      mapping,
      [],
    );
    expect(rows.map((r) => r.line)).toEqual([3]);
  });
});
