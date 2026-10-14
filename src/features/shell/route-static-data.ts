import type { Permission } from "@/features/auth/permissions";

/**
 * Every signed-in route names the permission it needs (spec §7.3, step 2).
 * `route-permissions.test.ts` fails if one doesn't.
 */
declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    permission?: Permission;
  }
}

export {};
