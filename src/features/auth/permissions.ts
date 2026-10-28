/**
 * Named permissions (spec §4.3). Screens, server functions and in-screen
 * controls ask for a permission, never a role name. Each member's role carries
 * a list of these (D39); 018-billing.sql keeps the same names in
 * staff_known_permissions(), and a test fails if the two differ.
 */
export const PERMISSIONS = [
  "dashboard.view",
  "crm.view",
  "crm.write",
  "crm.export",
  "users.view",
  "households.view",
  "users.suspend",
  "deletions.view",
  "deletions.process",
  "support.view",
  "support.write",
  "pay.view",
  "payouts.view",
  "ai.view",
  "audit.view",
  "team.manage",
  "billing.view",
  "billing.manage",
  "switches.manage",
  "revenue.view",
  "revenue.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * The locked presets (§4.2). Custom roles have none. Super admin is held by one
 * account and is given, moved or removed only from the SQL editor (D43).
 */
export type RolePreset = "super_admin" | "admin" | "mods" | "sales" | "support";

export function can(
  permissions: readonly string[] | null | undefined,
  permission: Permission,
): boolean {
  return !!permissions && permissions.includes(permission);
}

/** What each permission covers, as §4.3 words it. */
export const PERMISSION_LABEL: Record<Permission, string> = {
  "dashboard.view": "Dashboard",
  "crm.view": "See contacts, activities, follow-ups",
  "crm.write": "Create, edit, import, link contacts",
  "crm.export": "Download contacts as CSV",
  "users.view": "Users list and detail",
  "households.view": "Households list and detail",
  "users.suspend": "Suspend and unsuspend",
  "deletions.view": "Deletion requests",
  "deletions.process": "Process a deletion",
  "support.view": "Support tickets",
  "support.write": "Create and update tickets",
  "pay.view": "Reveal wages, payslip amounts, payout accounts",
  "payouts.view": "Payouts screen",
  "ai.view": "AI usage screen",
  "audit.view": "Audit log",
  "team.manage": "Team: add, remove, change roles; edit custom roles",
  "billing.view": "Plans and Subscriptions screens",
  "billing.manage": "Edit plans and add-ons, change a subscription",
  "switches.manage": "Global switches: turn a feature on or off for everyone",
  "revenue.view": "Revenue screen: cash, recurring revenue and profit",
  "revenue.manage": "Set Xendit fee rates, AI call costs and fixed costs",
};

/** The role editor's checkboxes, grouped as in the sidebar. Never team.manage (D39). */
export const PERMISSION_GROUPS: {
  label: "Customers" | "Operations" | "Admin";
  permissions: Permission[];
}[] = [
  {
    label: "Customers",
    permissions: [
      "dashboard.view",
      "crm.view",
      "crm.write",
      "crm.export",
      "users.view",
      "households.view",
      "users.suspend",
    ],
  },
  {
    label: "Operations",
    permissions: [
      "deletions.view",
      "deletions.process",
      "support.view",
      "support.write",
      "pay.view",
      "payouts.view",
      "ai.view",
      "billing.view",
      "billing.manage",
      "switches.manage",
      "revenue.view",
      "revenue.manage",
    ],
  },
  { label: "Admin", permissions: ["audit.view"] },
];
