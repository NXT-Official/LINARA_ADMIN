import { describe, expect, it } from "vitest";

import { decodeCsvBytes, parseCsv } from "./csv-parse";

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

describe("decodeCsvBytes", () => {
  it("reads UTF-8, the CSV UTF-8 option in Excel", () => {
    const bytes = new TextEncoder().encode("Name\r\nPeña\r\n");
    expect(decodeCsvBytes(bytes.buffer as ArrayBuffer)).toBe("Name\r\nPeña\r\n");
  });

  it("reads Windows Excel's plain CSV (Windows-1252) without losing ñ", () => {
    // "Peña, Muñoz" as Excel's "CSV (Comma delimited)" saves it: ñ is the single byte 0xF1.
    const bytes = new Uint8Array([0x50, 0x65, 0xf1, 0x61, 0x2c, 0x4d, 0x75, 0xf1, 0x6f, 0x7a]);
    expect(decodeCsvBytes(bytes.buffer)).toBe("Peña,Muñoz");
  });
});
