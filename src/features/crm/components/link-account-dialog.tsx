import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { USER_KIND_LABEL } from "@/data/labels";
import { listUsersFn } from "@/features/users/users.actions";
import { useDebouncedValue } from "@/lib/use-debounced-value";

import { linkContactFn } from "../crm.actions";

/**
 * Linking a lead by finding the account by hand (FR-CRM-6): for a lead with
 * only a phone number, or an email that differs from the account's. Only
 * household managers are offered; the server checks again.
 */
export function LinkAccountDialog({
  trigger,
  contactId,
  onLinked,
}: {
  trigger: ReactNode;
  contactId: string;
  onLinked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const search = useDebouncedValue(q.trim());
  const ready = open && search.length >= 2;

  const { data, isFetching } = useQuery({
    queryKey: ["users", { page: 0, search }],
    queryFn: () => listUsersFn({ data: { page: 0, search } }),
    enabled: ready,
  });
  const managers = data?.ok ? data.users.filter((u) => u.kind !== "helper") : [];

  async function link(userId: string) {
    setPending(userId);
    setError(null);
    try {
      const res = await linkContactFn({ data: { contactId, userId } });
      if (res.ok) {
        setOpen(false);
        setQ("");
        toast.success("Contact linked");
        onLinked();
      } else {
        setError(res.message);
      }
    } catch {
      setError("Something went wrong on our side. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="font-display text-xl font-normal">
            Link to a Linara account
          </DialogTitle>
          <DialogDescription>
            Find the manager's account. Linking makes this lead a customer; their history stays
            here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="link-search" className="text-xs font-semibold text-muted-foreground">
            Search managers by name or email
          </Label>
          <Input
            id="link-search"
            autoFocus
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {error ? (
          <p
            role="alert"
            className="rounded-xl bg-status-late-soft px-3 py-2 text-sm text-status-late-ink"
          >
            {error}
          </p>
        ) : null}
        {!ready ? (
          <p className="text-sm text-muted-foreground">Type at least 2 letters.</p>
        ) : isFetching && managers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Searching.</p>
        ) : data && !data.ok ? (
          <p className="text-sm text-muted-foreground">{data.message}</p>
        ) : managers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No manager matches.</p>
        ) : (
          <ul className="max-h-72 divide-y divide-border overflow-y-auto">
            {managers.map((u) => (
              <li key={u.userId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{u.fullName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {u.email}, {USER_KIND_LABEL[u.kind].toLowerCase()}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Link ${u.fullName}`}
                  disabled={pending !== null}
                  onClick={() => link(u.userId)}
                >
                  {pending === u.userId ? "Linking" : "Link"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
