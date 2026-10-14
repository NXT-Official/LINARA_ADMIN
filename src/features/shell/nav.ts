import {
  Activity,
  BadgeAlert,
  Building2,
  ContactRound,
  LayoutDashboard,
  LifeBuoy,
  ScrollText,
  ShieldCheck,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { Permission } from "@/features/auth/permissions";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
};

/** Grouped by what the business team is doing, not by table. */
export const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.view" }],
  },
  {
    label: "Customers",
    items: [
      { to: "/crm", label: "CRM", icon: ContactRound, permission: "crm.view" },
      { to: "/users", label: "Users", icon: Users, permission: "users.view" },
      { to: "/households", label: "Households", icon: Building2, permission: "households.view" },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/support", label: "Support", icon: LifeBuoy, permission: "support.view" },
      { to: "/deletions", label: "Deletion requests", icon: Trash2, permission: "deletions.view" },
      { to: "/payouts", label: "Payouts", icon: BadgeAlert, permission: "payouts.view" },
      { to: "/ai", label: "AI usage", icon: Activity, permission: "ai.view" },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/team", label: "Admins", icon: ShieldCheck, permission: "team.manage" },
      { to: "/audit", label: "Audit log", icon: ScrollText, permission: "audit.view" },
    ],
  },
];
