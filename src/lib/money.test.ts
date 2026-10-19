import { describe, expect, it } from "vitest";

import { centavosToPesos, fmtCentavos, pesosToCentavos } from "./money";

describe("money", () => {
  it("formats centavos with two decimals and a true minus", () => {
    expect(fmtCentavos(49900)).toBe("₱499.00");
    expect(fmtCentavos(123450)).toBe("₱1,234.50");
    expect(fmtCentavos(5)).toBe("₱0.05");
    expect(fmtCentavos(-8030300)).toBe("−₱80,303.00");
  });

  it("reads pesos with up to two decimals", () => {
    expect(pesosToCentavos("19.99")).toBe(1999);
    expect(pesosToCentavos(" 499 ")).toBe(49900);
    expect(pesosToCentavos("0.5")).toBe(50);
    expect(pesosToCentavos("1.234")).toBeNull();
    expect(pesosToCentavos("-1")).toBeNull();
    expect(pesosToCentavos("")).toBeNull();
    expect(pesosToCentavos("1.2.3")).toBeNull();
    expect(pesosToCentavos("99999999999999999999")).toBeNull();
  });

  it("converts centavos to pesos", () => {
    expect(centavosToPesos(1999)).toBe(19.99);
  });
});
