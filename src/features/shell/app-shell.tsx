import { useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronDown, LogOut, Menu } from "lucide-react";

import { EnvBadge } from "@/components/shared/env-badge";
import { LogoMark } from "@/components/shared/logo";
import { StatusChip } from "@/components/shared/status-chip";
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
import { can } from "@/features/auth/permissions";
import { currentStaff, listDeletionRequests, listPayouts, listTickets } from "@/data/queries";
import { cn } from "@/lib/utils";

import { NAV_GROUPS, type NavItem } from "./nav";

/** Counts beside a nav item: only work waiting on someone. */
function navCounts(): Record<string, number> {
  return {
    "/support": listTickets().filter((t) => t.status === "open").length,
    "/deletions": listDeletionRequests().filter((d) => d.status === "pending").length,
    "/payouts": listPayouts().length,
  };
}

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

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const role = currentStaff().role;
  const counts = navCounts();

  return (
    <nav aria-label="Console" className="space-y-5">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((i) => can(role, i.permission));
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
                  count={counts[item.to]}
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
  count,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  count?: number;
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
        {count ? (
          <span className="tabular-nums text-xs font-semibold text-terracotta-ink">
            {count}
            <span className="sr-only"> waiting</span>
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function AccountMenu() {
  const me = currentStaff();
  const navigate = useNavigate();
  const initials = me.fullName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full pl-1 pr-2 hover:bg-sand-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11"
          aria-label={`Account: ${me.fullName}`}
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-pine text-xs font-semibold text-primary-foreground">
            {initials}
          </span>
          <span className="hidden text-sm font-semibold text-foreground sm:inline">
            {me.fullName.split(" ")[0]}
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 rounded-xl">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-sm font-semibold text-foreground">{me.fullName}</span>
          <span className="block truncate text-xs text-muted-foreground">{me.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate({ to: "/sign-in" })}>
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
export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-border px-3 py-5 lg:flex">
        <div className="px-3">
          <Brand />
        </div>
        <div className="mt-8 flex-1 overflow-y-auto">
          <NavList />
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
            <NavList onNavigate={() => setMenuOpen(false)} />
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
            <StatusChip tone="quiet" className="hidden sm:inline-flex">
              Sample data
            </StatusChip>
            <EnvBadge />
            <AccountMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
