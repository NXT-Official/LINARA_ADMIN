import { describe, expect, it } from "vitest";

import { daysBetween, formatPeso, formatRelativeDay, plural } from "./format";

describe("daysBetween", () => {
  it("counts Manila calendar days, not 24-hour spans", () => {
    // 23:30 and 00:30 the next day in Manila are one day apart.
    expect(daysBetween("2026-10-14T15:30:00Z", "2026-10-14T16:30:00Z")).toBe(1);
    expect(daysBetween("2026-10-14T00:00:00Z", "2026-10-14T10:00:00Z")).toBe(0);
  });

  it("is negative when the second date is earlier", () => {
    expect(daysBetween("2026-10-14T04:00:00Z", "2026-10-11T04:00:00Z")).toBe(-3);
  });
});

describe("formatRelativeDay", () => {
  const now = new Date("2026-10-14T04:00:00Z");

  it("names the nearby days", () => {
    expect(formatRelativeDay("2026-10-14T09:00:00Z", now)).toBe("today");
    expect(formatRelativeDay("2026-10-13T04:00:00Z", now)).toBe("yesterday");
    expect(formatRelativeDay("2026-10-15T04:00:00Z", now)).toBe("tomorrow");
  });

  it("counts further days", () => {
    expect(formatRelativeDay("2026-10-10T04:00:00Z", now)).toBe("4 days ago");
    expect(formatRelativeDay("2026-10-20T04:00:00Z", now)).toBe("in 6 days");
  });
});

describe("formatPeso and plural", () => {
  it("formats pesos", () => {
    expect(formatPeso(6500)).toBe("₱6,500.00");
  });

  it("picks the singular for one", () => {
    expect(plural(1, "household")).toBe("1 household");
    expect(plural(1200, "household")).toBe("1,200 households");
  });
});
