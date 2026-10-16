import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { FormDialog } from "@/components/shared/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listContactsFn } from "@/features/crm/crm.actions";
import { listHouseholdsFn } from "@/features/households/households.actions";
import { listUsersFn } from "@/features/users/users.actions";
import { useDebouncedValue } from "@/lib/use-debounced-value";

import { setLinksFn } from "../support.actions";
import type { TicketDetail } from "../support.types";

type Picked = { id: string; name: string } | null;
type Kind = "user" | "household" | "contact";

/** Up to five matches for a search, for picking one record (FR-SP-1). */
async function find(kind: Kind, search: string): Promise<{ id: string; name: string }[]> {
  if (kind === "user") {
    const res = await listUsersFn({ data: { page: 0, search } });
    return res.ok ? res.users.slice(0, 5).map((u) => ({ id: u.userId, name: u.fullName })) : [];
  }
  if (kind === "household") {
    const res = await listHouseholdsFn({ data: { page: 0, search } });
    return res.ok
      ? res.households.slice(0, 5).map((h) => ({ id: h.householdId, name: h.name }))
      : [];
  }
  const res = await listContactsFn({ data: { page: 0, search } });
  // Only saved contacts can be linked; a manager not saved yet links as a user.
  return res.ok
    ? res.contacts
        .filter((c) => c.contactId)
        .slice(0, 5)
        .map((c) => ({ id: c.contactId as string, name: c.fullName }))
    : [];
}

function RecordPicker({
  kind,
  label,
  picked,
  onPick,
}: {
  kind: Kind;
  label: string;
  picked: Picked;
  onPick: (p: Picked) => void;
}) {
  const [q, setQ] = useState("");
  const search = useDebouncedValue(q.trim());
  const { data = [], isFetching } = useQuery({
    queryKey: ["link-picker", kind, search],
    queryFn: () => find(kind, search),
    enabled: search.length >= 2,
  });
  const id = `pick-${kind}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-muted-foreground">
        {label}
      </label>
      {picked ? (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-sand-deep px-3 py-2 text-sm">
          <span className="truncate">{picked.name}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => onPick(null)}>
            Remove
          </Button>
        </div>
      ) : (
        <>
          <Input
            id={id}
            autoComplete="off"
            placeholder="Type 2 letters or more"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {search.length >= 2 ? (
            data.length ? (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {data.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-sand/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:py-3"
                      onClick={() => {
                        onPick(r);
                        setQ("");
                      }}
                    >
                      {r.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                {isFetching ? "Searching." : "No match."}
              </p>
            )
          ) : null}
        </>
      )}
    </div>
  );
}

/** Links a ticket to a user, a household and a CRM contact, each optional (FR-SP-1). */
export function LinksDialog({
  trigger,
  ticket,
  onSaved,
}: {
  trigger: ReactNode;
  ticket: TicketDetail;
  onSaved: () => void;
}) {
  const initial = {
    user: ticket.userId ? { id: ticket.userId, name: ticket.userName ?? "Linked user" } : null,
    household: ticket.householdId
      ? { id: ticket.householdId, name: ticket.householdName ?? "Linked household" }
      : null,
    contact: ticket.contactId
      ? { id: ticket.contactId, name: ticket.contactName ?? "Linked contact" }
      : null,
  };
  const [user, setUser] = useState<Picked>(initial.user);
  const [household, setHousehold] = useState<Picked>(initial.household);
  const [contact, setContact] = useState<Picked>(initial.contact);
  return (
    <FormDialog
      trigger={trigger}
      title="Link this ticket"
      description="To the person's Linara account, their household and their CRM contact. Each is optional."
      submitLabel="Save links"
      done="Links saved"
      // Opening starts from the ticket as it is now, so a cancelled change or
      // another admin's edit isn't saved by accident.
      onOpenChange={(open) => {
        if (!open) return;
        setUser(initial.user);
        setHousehold(initial.household);
        setContact(initial.contact);
      }}
      onSubmit={async () => {
        const res = await setLinksFn({
          data: {
            ticketId: ticket.ticketId,
            userId: user?.id ?? null,
            householdId: household?.id ?? null,
            contactId: contact?.id ?? null,
          },
        });
        if (res.ok) onSaved();
        return res;
      }}
    >
      <RecordPicker kind="user" label="Find a user" picked={user} onPick={setUser} />
      <RecordPicker
        kind="household"
        label="Find a household"
        picked={household}
        onPick={setHousehold}
      />
      <RecordPicker
        kind="contact"
        label="Find a CRM contact"
        picked={contact}
        onPick={setContact}
      />
    </FormDialog>
  );
}
