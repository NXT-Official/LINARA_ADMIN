import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Field, FormDialog, SelectField } from "@/components/shared/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fmtCentavos, pesosToCentavos } from "@/lib/money";

import { saveCostFn } from "../finance.actions";
import { FINANCE_KEYS } from "../finance-keys";
import { CATEGORY_LABEL, COST_CATEGORIES, type Cost, type CostCategory } from "../finance.types";

const OPTIONS = COST_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }));
const pesosText = (centavos: number) => (centavos / 100).toFixed(2);

/** The current month as "YYYY-MM" in the viewer's calendar. */
function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Add a cost (cost = null) or edit one. A cost belongs to a month; it counts
 * toward COGS in any range that includes that month's first day. Mount it
 * only while open when editing; the add dialog stays mounted, so it resets on every open.
 */
export function CostDialog({
  cost,
  trigger,
  open,
  onOpenChange,
}: {
  cost: Cost | null;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(cost ? cost.month.slice(0, 7) : thisMonth());
  const [category, setCategory] = useState<CostCategory>(cost?.category ?? "infra");
  const [label, setLabel] = useState(cost?.label ?? "");
  const [amount, setAmount] = useState(cost ? pesosText(cost.amountCentavos) : "");
  const [note, setNote] = useState(cost?.note ?? "");
  const [innerOpen, setInnerOpen] = useState(false);

  /** Every open starts from the saved cost, or empty for an add. */
  function reset() {
    setMonth(cost ? cost.month.slice(0, 7) : thisMonth());
    setCategory(cost?.category ?? "infra");
    setLabel(cost?.label ?? "");
    setAmount(cost ? pesosText(cost.amountCentavos) : "");
    setNote(cost?.note ?? "");
  }

  return (
    <FormDialog
      trigger={trigger}
      open={open ?? innerOpen}
      onOpenChange={(next) => {
        if (next) reset();
        setInnerOpen(next);
        onOpenChange?.(next);
      }}
      title={cost ? "Edit cost" : "Add cost"}
      description="A cost you pay to run Linara, counted in the month you pick."
      submitLabel={cost ? "Save cost" : "Add cost"}
      done={cost ? "Cost saved" : "Cost added"}
      onSubmit={async () => {
        if (!/^\d{4}-\d{2}$/.test(month)) {
          return { ok: false as const, message: "Pick a month." };
        }
        if (label.trim() === "") {
          return { ok: false as const, message: "Give the cost a label." };
        }
        const centavos = pesosToCentavos(amount);
        if (centavos === null) {
          return { ok: false as const, message: "Use pesos with up to two decimals." };
        }
        const res = await saveCostFn({
          data: {
            ...(cost ? { id: cost.id } : {}),
            month: `${month}-01`,
            category,
            label: label.trim(),
            amountCentavos: centavos,
            note: note.trim() === "" ? null : note.trim(),
          },
        });
        if (res.ok) await queryClient.invalidateQueries({ queryKey: FINANCE_KEYS.all });
        return res;
      }}
    >
      {(id) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Month" htmlFor={id("month")}>
              <Input
                id={id("month")}
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </Field>
            <Field label="Category" htmlFor={id("category")}>
              <SelectField
                id={id("category")}
                value={category}
                onChange={setCategory}
                options={OPTIONS}
              />
            </Field>
          </div>
          <Field label="Label" htmlFor={id("label")}>
            <Input
              id={id("label")}
              autoComplete="off"
              maxLength={120}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Field
            label="Amount (pesos)"
            htmlFor={id("amount")}
            hint={
              amount !== "" && pesosToCentavos(amount) !== null
                ? fmtCentavos(pesosToCentavos(amount) ?? 0)
                : undefined
            }
          >
            <Input
              id={id("amount")}
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Note" htmlFor={id("note")}>
            <Textarea
              id={id("note")}
              rows={2}
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}
