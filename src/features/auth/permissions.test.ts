import { describe, expect, it } from "vitest";

import { PERMISSIONS, can } from "./permissions";

describe("can", () => {
  it("gives admin every permission", () => {
    for (const p of PERMISSIONS) expect(can("admin", p)).toBe(true);
  });

  it("gives an account without a console role nothing", () => {
    expect(can(null, "dashboard.view")).toBe(false);
    expect(can(undefined, "crm.view")).toBe(false);
  });
});
