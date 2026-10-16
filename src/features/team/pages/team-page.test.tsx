// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PERMISSION_LABEL, PERMISSIONS, type RolePreset } from "@/features/auth/permissions";
import { StaffProvider } from "@/features/auth/staff-provider";
import { toast } from "sonner";

import type { AdminRow } from "../team.handlers.server";
import type { RoleRow } from "../roles.types";

const m = vi.hoisted(() => ({
  listAdmins: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  listRoles: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  setRole: vi.fn(),
}));
vi.mock("../team.actions", () => ({
  listAdminsFn: (...a: unknown[]) => m.listAdmins(...a),
  addAdminFn: (...a: unknown[]) => m.add(...a),
  removeAdminFn: (...a: unknown[]) => m.remove(...a),
}));
vi.mock("../roles.actions", () => ({
  listRolesFn: (...a: unknown[]) => m.listRoles(...a),
  createRoleFn: (...a: unknown[]) => m.create(...a),
  updateRoleFn: (...a: unknown[]) => m.update(...a),
  deleteRoleFn: (...a: unknown[]) => m.del(...a),
  setMemberRoleFn: (...a: unknown[]) => m.setRole(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TeamPage } from "./team-page";

// input-otp measures itself and looks for password managers; jsdom has neither API.
document.elementFromPoint ??= () => null;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const SEEN = "2026-10-16T01:02:03.456Z";
const ALL = [...PERMISSIONS];
const role = (
  roleId: string,
  preset: RolePreset | null,
  name: string,
  permissions: string[],
  memberCount: number,
): RoleRow => ({
  roleId,
  preset,
  name,
  description: null,
  permissions: permissions as RoleRow["permissions"],
  memberCount,
  updatedAt: SEEN,
});
const ROLES = [
  role("r-admin", "admin", "Admin", ALL, 2),
  role("r-mods", "mods", "Mods", ALL, 1),
  role("r-sales", "sales", "Sales", ["dashboard.view", "crm.view"], 1),
  role("r-sup", "support", "Support", ["dashboard.view", "support.view"], 0),
  role("r-lead", null, "Lead desk", ["crm.view", "dashboard.view"], 1),
  role("r-unused", null, "Unused", ["dashboard.view"], 0),
];
const member = (
  userId: string,
  email: string,
  roleId: string,
  roleName: string,
  preset: RolePreset | null,
): AdminRow => ({
  userId,
  email,
  addedAt: "2026-10-01T00:00:00Z",
  lastSignInAt: null,
  twoStepSetUp: true,
  isYou: false,
  roleId,
  roleName,
  preset,
});
const MEMBERS = [
  member("me", "me@x.com", "r-admin", "Admin", "admin"),
  member("b", "b@x.com", "r-admin", "Admin", "admin"),
  member("m", "mod@x.com", "r-mods", "Mods", "mods"),
  member("s", "sales@x.com", "r-sales", "Sales", "sales"),
  member("c", "lead@x.com", "r-lead", "Lead desk", null),
];

function renderPage(tab: "members" | "roles", as: { userId: string; preset: RolePreset }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StaffProvider staff={{ ...as, email: "me@x.com", roleName: as.preset, permissions: ALL }}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </StaffProvider>
  );
  return render(<TeamPage tab={tab} />, { wrapper });
}
const ADMIN = { userId: "me", preset: "admin" as const };
const MOD = { userId: "m", preset: "mods" as const };

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.listAdmins.mockResolvedValue({
    ok: true,
    admins: MEMBERS.map((x) => ({ ...x, isYou: x.userId === "me" })),
  });
  m.listRoles.mockResolvedValue({ ok: true, roles: ROLES });
  for (const f of [m.add, m.remove, m.update, m.del, m.setRole]) f.mockResolvedValue({ ok: true });
  m.create.mockResolvedValue({ ok: true, roleId: "r-new" });
});
afterEach(cleanup);

const row = (text: string) =>
  screen.getAllByRole("row").find((r) => r.textContent?.includes(text)) as HTMLElement;

describe("Members tab (FR-TM-1 to FR-TM-3, FR-RL-6)", () => {
  it("rows show role, last sign-in, two-step", async () => {
    renderPage("members", ADMIN);
    await screen.findAllByText("lead@x.com");
    expect(within(row("lead@x.com")).getByText("Lead desk")).toBeInTheDocument();
    expect(within(row("lead@x.com")).getByText("Never")).toBeInTheDocument();
    expect(within(row("lead@x.com")).getByText("Set up")).toBeInTheDocument();
  });

  it("add member asks for the code for admin, mods and custom roles, not sales", async () => {
    renderPage("members", ADMIN);
    await screen.findAllByText("lead@x.com");
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Work email"), {
      target: { value: "new@x.com" },
    });
    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "r-sales" } });
    expect(within(dialog).queryByLabelText("Your two-step code")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "r-mods" } });
    expect(within(dialog).getByLabelText("Your two-step code")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "r-lead" } });
    expect(within(dialog).getByLabelText("Your two-step code")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "r-sales" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invite" }));
    await waitFor(() =>
      expect(m.add).toHaveBeenCalledWith({ data: { email: "new@x.com", roleId: "r-sales" } }),
    );
  });

  it("add member explains what happens next and whose code it asks for", async () => {
    renderPage("members", ADMIN);
    await screen.findAllByText("lead@x.com");
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "We'll email them a link to choose their own password, then set up two-step sign-in on their phone. They can't open anything until both are done.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Use a work email only for the console. An email that already has a Linara app account can't be added.",
      ),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "r-mods" } });
    expect(within(dialog).getByLabelText("Your two-step code")).toHaveAccessibleDescription(
      "The 6-digit code in your authenticator app. It confirms it's you adding them.",
    );
  });

  it("adding someone who already has a console login says they can sign in", async () => {
    m.add.mockResolvedValue({ ok: true, outcome: "existing" });
    renderPage("members", ADMIN);
    await screen.findAllByText("lead@x.com");
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Work email"), {
      target: { value: "back@x.com" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invite" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Added. They already have a console login, so they can sign in with their password and two-step code.",
      ),
    );
  });

  it("add member starts on Sales and can send without touching the role", async () => {
    renderPage("members", ADMIN);
    await screen.findAllByText("lead@x.com");
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Role")).toHaveValue("r-sales");
    fireEvent.change(within(dialog).getByLabelText("Work email"), {
      target: { value: "new@x.com" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invite" }));
    await waitFor(() =>
      expect(m.add).toHaveBeenCalledWith({ data: { email: "new@x.com", roleId: "r-sales" } }),
    );
  });

  it("change role offers only assignable roles", async () => {
    renderPage("members", MOD);
    await screen.findAllByText("sales@x.com");
    fireEvent.click(within(row("sales@x.com")).getByRole("button", { name: "Change role" }));
    const dialog = await screen.findByRole("dialog");
    const options = within(within(dialog).getByLabelText("Role"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["Sales", "Support", "Lead desk", "Unused"]);
    fireEvent.change(within(dialog).getByLabelText("Role"), { target: { value: "r-lead" } });
    fireEvent.change(within(dialog).getByLabelText("Your two-step code"), {
      target: { value: "123456" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Change role" }));
    await waitFor(() =>
      expect(m.setRole).toHaveBeenCalledWith({
        data: { userId: "s", roleId: "r-lead", code: "123456" },
      }),
    );
  });

  it("rows you can't change show why and no actions", async () => {
    renderPage("members", MOD);
    await screen.findAllByText("b@x.com");
    expect(
      within(row("b@x.com")).getByText("Only admins can change admins and mods."),
    ).toBeVisible();
    expect(within(row("b@x.com")).queryByRole("button")).toBeNull();
    expect(within(row("mod@x.com")).getByText("This is you.")).toBeInTheDocument();
  });

  it("remove still asks for the code", async () => {
    renderPage("members", ADMIN);
    await screen.findAllByText("sales@x.com");
    fireEvent.click(within(row("sales@x.com")).getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Your two-step code")).toBeInTheDocument();
  });
});

describe("Roles tab (FR-RL-1 to FR-RL-5)", () => {
  it("lists presets first with counts", async () => {
    renderPage("roles", ADMIN);
    await screen.findAllByText("Lead desk");
    const names = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(names).toEqual(["Admin", "Mods", "Sales", "Support", "Lead desk", "Unused"]);
    expect(within(row("Lead desk")).getByText("Custom")).toBeInTheDocument();
    expect(within(row("Sales")).getByText("Preset")).toBeInTheDocument();
  });

  it("a preset opens read-only with Duplicate", async () => {
    renderPage("roles", ADMIN);
    await screen.findAllByText("Sales");
    fireEvent.click(within(row("Sales")).getByRole("button", { name: "Open Sales" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(PERMISSION_LABEL["crm.view"])).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Duplicate" })).toBeInTheDocument();
  });

  it("duplicate opens the editor with its permissions minus team.manage", async () => {
    renderPage("roles", ADMIN);
    await screen.findAllByText("Mods");
    fireEvent.click(within(row("Mods")).getByRole("button", { name: "Open Mods" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Duplicate" }),
    );
    const editor = await screen.findByRole("dialog", { name: "New role" });
    expect(within(editor).getByLabelText("Name")).toHaveValue("Mods copy");
    expect(
      within(editor).getByRole("checkbox", { name: PERMISSION_LABEL["audit.view"] }),
    ).toBeChecked();
    expect(
      within(editor).queryByRole("checkbox", { name: PERMISSION_LABEL["team.manage"] }),
    ).toBeNull();
    expect(within(editor).getByRole("button", { name: "Create role" })).toBeDisabled();
    fireEvent.change(within(editor).getByLabelText("Your two-step code"), {
      target: { value: "123456" },
    });
    fireEvent.click(within(editor).getByRole("button", { name: "Create role" }));
    await waitFor(() => expect(m.create).toHaveBeenCalled());
    expect(m.create.mock.calls[0][0].data.code).toBe("123456");
    expect(m.create.mock.calls[0][0].data.permissions).not.toContain("team.manage");
  });

  it("the editor never offers Manage team and roles, and the dashboard is always on", async () => {
    renderPage("roles", ADMIN);
    await screen.findAllByText("Lead desk");
    fireEvent.click(screen.getByRole("button", { name: "New role" }));
    const editor = await screen.findByRole("dialog", { name: "New role" });
    expect(
      within(editor).queryByRole("checkbox", { name: PERMISSION_LABEL["team.manage"] }),
    ).toBeNull();
    const dashboard = within(editor).getByRole("checkbox", {
      name: PERMISSION_LABEL["dashboard.view"],
    });
    expect(dashboard).toBeChecked();
    expect(dashboard).toBeDisabled();
  });

  it("saving changed permissions asks for the code, a rename doesn't", async () => {
    renderPage("roles", ADMIN);
    await screen.findAllByText("Lead desk");
    fireEvent.click(within(row("Lead desk")).getByRole("button", { name: "Open Lead desk" }));
    const editor = await screen.findByRole("dialog", { name: "Lead desk" });
    fireEvent.change(within(editor).getByLabelText("Name"), { target: { value: "Lead team" } });
    expect(within(editor).queryByLabelText("Your two-step code")).toBeNull();
    fireEvent.click(within(editor).getByRole("button", { name: "Save role" }));
    await waitFor(() =>
      expect(m.update).toHaveBeenCalledWith({
        data: {
          roleId: "r-lead",
          name: "Lead team",
          description: "",
          permissions: ["crm.view", "dashboard.view"],
          seenUpdatedAt: SEEN,
        },
      }),
    );

    fireEvent.click(within(row("Lead desk")).getByRole("button", { name: "Open Lead desk" }));
    const again = await screen.findByRole("dialog", { name: "Lead desk" });
    fireEvent.click(within(again).getByRole("checkbox", { name: PERMISSION_LABEL["crm.write"] }));
    expect(within(again).getByLabelText("Your two-step code")).toBeInTheDocument();
  });

  it("a stale save shows the reload message", async () => {
    m.update.mockResolvedValue({
      ok: false,
      code: "conflict",
      message: "Someone else changed this role. Reload to see their changes.",
    });
    renderPage("roles", ADMIN);
    await screen.findAllByText("Lead desk");
    fireEvent.click(within(row("Lead desk")).getByRole("button", { name: "Open Lead desk" }));
    const editor = await screen.findByRole("dialog", { name: "Lead desk" });
    fireEvent.change(within(editor).getByLabelText("Name"), { target: { value: "Lead team" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save role" }));
    expect(
      await within(editor).findByText(
        "Someone else changed this role. Reload to see their changes.",
      ),
    ).toBeInTheDocument();
  });

  it("deleting an unused role asks to confirm first (FR-RL-5)", async () => {
    renderPage("roles", ADMIN);
    await screen.findAllByText("Unused");
    fireEvent.click(within(row("Unused")).getByRole("button", { name: "Open Unused" }));
    const editor = await screen.findByRole("dialog", { name: "Unused" });
    fireEvent.click(within(editor).getByRole("button", { name: "Delete role" }));
    expect(m.del).not.toHaveBeenCalled();
    expect(within(editor).getByText("Delete this role? This can't be undone.")).toBeInTheDocument();
    fireEvent.click(within(editor).getByRole("button", { name: "Keep it" }));
    expect(within(editor).queryByText("Delete this role? This can't be undone.")).toBeNull();
    fireEvent.click(within(editor).getByRole("button", { name: "Delete role" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(m.del).toHaveBeenCalledWith({ data: { roleId: "r-unused" } }));
  });

  it("delete is disabled with the member count", async () => {
    renderPage("roles", ADMIN);
    await screen.findAllByText("Lead desk");
    fireEvent.click(within(row("Lead desk")).getByRole("button", { name: "Open Lead desk" }));
    const editor = await screen.findByRole("dialog", { name: "Lead desk" });
    expect(within(editor).getByRole("button", { name: "Delete role" })).toBeDisabled();
    expect(within(editor).getByText("1 member has this role.")).toBeInTheDocument();
  });
});
