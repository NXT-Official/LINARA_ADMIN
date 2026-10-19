import { AUDIT_ACTION_LABEL } from "@/data/labels";

/** What an entry is about, for the audit filter and table. */
export const TARGET_LABEL: Record<string, string> = {
  user: "User",
  household: "Household",
  ticket: "Ticket",
  contact: "Contact",
  staff: "Team member",
  role: "Role",
  payout: "Payout",
  export: "Export",
  import: "Import",
  helper: "Helper",
  auth: "Sign-in",
  invoice: "Invoice",
  plan: "Plan",
  settings: "Settings",
  faq: "FAQ",
  subscription: "Subscription",
  cost: "Cost",
  model_price: "AI price",
};

export function actionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? action;
}

/** Where an entry's target lives in the console, if it has a page (FR-AU-2). */
export function targetHref(e: {
  targetType: string | null;
  targetId: string | null;
}): string | null {
  if (!e.targetId) return null;
  switch (e.targetType) {
    case "user":
      return `/users/${e.targetId}`;
    case "household":
      return `/households/${e.targetId}`;
    case "ticket":
      return `/support/${e.targetId}`;
    case "contact":
      return `/crm/${e.targetId}`;
    case "staff":
      return "/team";
    case "role":
      return "/team?tab=roles";
    case "plan":
      return "/plans";
    case "faq":
      return "/faqs";
    case "cost":
    case "model_price":
      return "/finance";
    default:
      return null;
  }
}
