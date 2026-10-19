import { describe, expect, it } from "vitest";

import { monthHeading, pesoAxisLabel, rangeFor, seriesForChart } from "./finance.utils";

describe("rangeFor", () => {
  const today = new Date(2026, 9, 19);
  it("this month runs first to last day", () => {
    expect(rangeFor("this_month", today)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
  it("last 3 months starts two months back and ends this month", () => {
    expect(rangeFor("last_3_months", today)).toEqual({ from: "2026-08-01", to: "2026-10-31" });
  });
  it("last 3 months crosses a year boundary", () => {
    expect(rangeFor("last_3_months", new Date(2026, 0, 5))).toEqual({
      from: "2025-11-01",
      to: "2026-01-31",
    });
  });
  it("this year is January to December", () => {
    expect(rangeFor("this_year", today)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
  it("handles a leap February", () => {
    expect(rangeFor("this_month", new Date(2028, 1, 10)).to).toBe("2028-02-29");
  });
});

describe("seriesForChart", () => {
  it("converts centavos to pesos with short month names and keeps negative profit", () => {
    const rows = seriesForChart({
      series: [
        {
          month: "2026-09",
          revenueCentavos: 69700,
          cogsCentavos: 150000,
          profitCentavos: -80300,
          aiCalls: 3,
        },
      ],
    });
    expect(rows).toEqual([{ month: "Sep", revenue: 697, cogs: 1500, profit: -803 }]);
  });
});

describe("labels", () => {
  it("formats the axis compactly with a true minus", () => {
    expect(pesoAxisLabel(950)).toBe("₱950");
    expect(pesoAxisLabel(1200)).toBe("₱1.2K");
    expect(pesoAxisLabel(-12000)).toBe("−₱12K");
    expect(pesoAxisLabel(2000)).toBe("₱2K");
  });
  it("names a month", () => {
    expect(monthHeading("2026-10-01")).toBe("October 2026");
  });
});
