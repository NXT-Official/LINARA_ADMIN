import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronDown, LogOut, Menu } from "lucide-react";

import { EnvBadge } from "@/components/shared/env-badge";
import { LogoMark } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { signOutFn } from "@/features/auth/auth.actions";
import { can } from "@/features/auth/permissions";
import type { SessionStaff } from "@/features/auth/use-can";
import { cn } from "@/lib/utils";

import { NAV_GROUPS, type NavItem } from "./nav";

function isActive(pathname: string, to: string) {
  return to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
}

function Brand() {
  return (
    <Link
      to="/"
      className="inline-flex items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <LogoMark className="h-8 w-8 shrink-0" />
      <span className="leading-none">
        <span className="block font-wordmark text-xl font-semibold tracking-tight text-primary">
          linara
        </span>
        <span className="mt-0.5 block text-xs font-semibold text-muted-foreground">
          Business Console
        </span>
      </span>
    </Link>
  );
}

export type ShellStaff = SessionStaff;

function NavList({
  permissions,
  onNavigate,
}: {
  permissions: readonly string[];
  onNavigate?: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav aria-label="Console" className="space-y-5">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((i) => can(permissions, i.permission));
        if (items.length === 0) return null;
        return (
          <div key={group.label ?? "top"}>
            {group.label ? (
              <p className="px-3 pb-1.5 text-xs font-semibold text-muted-foreground">
                {group.label}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  item={item}
                  active={isActive(pathname, item.to)}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        to={item.to}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors pointer-coarse:h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active
            ? "bg-sand-deep font-semibold text-pine"
            : "text-muted-foreground hover:bg-sand-deep/60 hover:text-foreground",
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0", active && "text-pine")} aria-hidden="true" />
        <span className="flex-1 truncate">{item.label}</span>
      </Link>
    </li>
  );
}

function AccountMenu({ staff }: { staff: ShellStaff }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Members have no stored name: the work email identifies them.
  const local = staff.email.split("@")[0] ?? "";
  const initials = local.slice(0, 2).toUpperCase() || "A";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full pl-1 pr-2 hover:bg-sand-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11"
          aria-label={`Account: ${staff.email}`}
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-pine text-xs font-semibold text-primary-foreground">
            {initials}
          </span>
          <span className="hidden text-sm font-semibold text-foreground sm:inline">{local}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 rounded-xl">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-xs text-muted-foreground">Signed in as</span>
          <span className="block truncate text-sm font-semibold text-foreground">
            {staff.email}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">{staff.roleName}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await signOutFn().catch(() => undefined);
            // Nothing loaded for this admin outlives their session (D41).
            queryClient.clear();
            navigate({ to: "/sign-in" });
          }}
        >
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The console's frame: a sidebar from `lg`, a menu drawer below it (NFR-3), and
 * a header carrying the environment on every screen (NFR-8).
 */
export function AppShell({ staff, children }: { staff: ShellStaff; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-border px-3 py-5 lg:flex">
        <div className="px-3">
          <Brand />
        </div>
        <div className="mt-8 flex-1 overflow-y-auto">
          <NavList permissions={staff.permissions} />
        </div>
      </aside>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 overflow-y-auto bg-background px-3 py-5">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Console sections</SheetDescription>
          <div className="px-3">
            <Brand />
          </div>
          <div className="mt-8">
            <NavList permissions={staff.permissions} onNavigate={() => setMenuOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background px-4 sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu />
          </Button>
          <div className="lg:hidden">
            <LogoMark className="h-8 w-8" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <EnvBadge />
            <AccountMenu staff={staff} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
