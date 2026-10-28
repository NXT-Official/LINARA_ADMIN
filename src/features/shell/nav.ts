import {
  Activity,
  BadgeAlert,
  Building2,
  CreditCard,
  ContactRound,
  LayoutDashboard,
  LifeBuoy,
  Layers,
  ScrollText,
  ShieldCheck,
  ToggleRight,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { Permission } from "@/features/auth/permissions";
import type { MessageKey } from "@/lib/i18n/messages";

export type NavItem = {
  to: string;
  label: MessageKey;
  icon: LucideIcon;
  permission: Permission;
};

/** Grouped by what the business team is doing, not by table. */
export const NAV_GROUPS: { label: MessageKey | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      { to: "/", label: "nav.dashboard", icon: LayoutDashboard, permission: "dashboard.view" },
    ],
  },
  {
    label: "nav.customers",
    items: [
      { to: "/crm", label: "nav.crm", icon: ContactRound, permission: "crm.view" },
      { to: "/users", label: "nav.users", icon: Users, permission: "users.view" },
      {
        to: "/households",
        label: "nav.households",
        icon: Building2,
        permission: "households.view",
      },
    ],
  },
  {
    label: "nav.operations",
    items: [
      { to: "/support", label: "nav.support", icon: LifeBuoy, permission: "support.view" },
      { to: "/deletions", label: "nav.deletions", icon: Trash2, permission: "deletions.view" },
      { to: "/payouts", label: "nav.payouts", icon: BadgeAlert, permission: "payouts.view" },
      { to: "/ai", label: "nav.ai", icon: Activity, permission: "ai.view" },
      { to: "/billing", label: "nav.billing", icon: CreditCard, permission: "billing.view" },
      { to: "/plans", label: "nav.plans", icon: Layers, permission: "billing.view" },
    ],
  },
  {
    label: "nav.admin",
    items: [
      { to: "/team", label: "nav.team", icon: ShieldCheck, permission: "team.manage" },
      { to: "/switches", label: "nav.switches", icon: ToggleRight, permission: "switches.manage" },
      { to: "/audit", label: "nav.audit", icon: ScrollText, permission: "audit.view" },
    ],
  },
];
