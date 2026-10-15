import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv-parse";

describe("parseCsv (RFC 4180)", () => {
  it("parses what Excel writes", () => {
    const text = '﻿Name,Email,Notes\r\n"Santos, Lia",lia@example.com,"Said ""yes"""\r\nPaolo,,\r\n';
    expect(parseCsv(text)).toEqual([
      ["Name", "Email", "Notes"],
      ["Santos, Lia", "lia@example.com", 'Said "yes"'],
      ["Paolo", "", ""],
    ]);
  });

  it("quoted newline stays in one cell", () => {
    expect(parseCsv('a,b\n"line one\nline two",x\n')).toEqual([
      ["a", "b"],
      ["line one\nline two", "x"],
    ]);
  });

  it("handles LF only, no final newline and blank lines", () => {
    expect(parseCsv("a,b\n1,2\n\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("an empty file has no rows", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("﻿\r\n")).toEqual([]);
  });
});
