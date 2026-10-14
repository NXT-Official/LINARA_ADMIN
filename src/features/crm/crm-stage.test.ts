import { describe, expect, it } from "vitest";

import type { HouseholdHelper } from "@/data/types";

import { customerStage, householdStage } from "./crm-stage";

const now = new Date("2026-10-14T04:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

function helper(status: HouseholdHelper["status"]): HouseholdHelper {
  return {
    id: "h",
    userId: null,
    name: "Helper",
    station: "Kitchen",
    employment: "live-in",
    status,
    startedOn: daysAgo(90),
    endedOn: null,
    monthlyRate: 6500,
  };
}

describe("householdStage", () => {
  it("is signed up with no helper and no tasks", () => {
    expect(householdStage({ helpers: [], lastActivityAt: null }, now)).toBe("signed_up");
    expect(householdStage({ helpers: [helper("PENDING_CLAIM")], lastActivityAt: null }, now)).toBe(
      "signed_up",
    );
  });

  it("is set up once a helper has joined, before any task", () => {
    expect(householdStage({ helpers: [helper("ACTIVE")], lastActivityAt: null }, now)).toBe(
      "set_up",
    );
  });

  it("is active with a task in the last 7 days", () => {
    expect(householdStage({ helpers: [helper("ACTIVE")], lastActivityAt: daysAgo(7) }, now)).toBe(
      "active",
    );
  });

  it("is at risk from 8 to 30 days, and inactive after", () => {
    const h = [helper("ACTIVE")];
    expect(householdStage({ helpers: h, lastActivityAt: daysAgo(8) }, now)).toBe("at_risk");
    expect(householdStage({ helpers: h, lastActivityAt: daysAgo(30) }, now)).toBe("at_risk");
    expect(householdStage({ helpers: h, lastActivityAt: daysAgo(31) }, now)).toBe("inactive");
  });

  it("stays signed up when idle and never set up", () => {
    expect(householdStage({ helpers: [], lastActivityAt: daysAgo(20) }, now)).toBe("signed_up");
  });
});

describe("customerStage", () => {
  it("takes the best stage across a manager's households", () => {
    const idle = { helpers: [helper("ACTIVE")], lastActivityAt: daysAgo(40) };
    const busy = { helpers: [helper("ACTIVE")], lastActivityAt: daysAgo(1) };
    expect(customerStage([idle, busy], now)).toBe("active");
    expect(customerStage([idle], now)).toBe("inactive");
  });
});
