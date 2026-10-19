import type { Plan } from "./plans.types";

/** A plan for tests (test-only). */
export const examplePlan = (over: Partial<Plan> = {}): Plan => ({
  id: "7f0c2a7e-1b2c-4d5e-8f90-123456789abc",
  name: "Home",
  tagline: "",
  inclusions: [],
  interval: "monthly",
  baseCentavos: 49900,
  includedHelpers: 1,
  includedManagers: 2,
  includedHomes: null,
  extraHelperCentavos: 9900,
  extraManagerCentavos: null,
  extraHomeCentavos: null,
  trialDays: 0,
  isPublic: true,
  status: "active",
  sortOrder: 0,
  ...over,
});
