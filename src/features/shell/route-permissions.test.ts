import { describe, expect, it } from "vitest";

import { PERMISSIONS, type Permission } from "@/features/auth/permissions";
import { getRouter } from "@/router";

import { NAV_GROUPS } from "./nav";

type AnyRoute = {
  id: string;
  fullPath: string;
  options?: { staticData?: { permission?: Permission } };
};

// Route ids and paths are filled in when a router is built from the tree.
const router = getRouter();
const leaves = (Object.values(router.routesById) as unknown as AnyRoute[]).filter(
  (r) => r.id.startsWith("/_authed/") && r.id !== "/_authed",
);
describe("every signed-in screen names a permission (spec §7.3, step 2)", () => {
  it("finds the signed-in screens", () => {
    expect(leaves.length).toBe(21);
  });

  it("each one has a known permission", () => {
    const missing = leaves
      .filter((r) => !PERMISSIONS.includes(r.options?.staticData?.permission as Permission))
      .map((r) => r.id);
    expect(missing).toEqual([]);
  });

  it("each nav item asks for the same permission as its screen", () => {
    const byPath = new Map(
      leaves.map((r) => [r.fullPath.replace(/\/$/, "") || "/", r.options?.staticData?.permission]),
    );
    const mismatched = NAV_GROUPS.flatMap((g) => g.items)
      .filter((i) => byPath.get(i.to) !== i.permission)
      .map((i) => `${i.to}: nav ${i.permission}, route ${byPath.get(i.to)}`);
    expect(mismatched).toEqual([]);
  });
});
