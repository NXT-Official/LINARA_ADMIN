import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Field, FormDialog } from "@/components/shared/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { pesosToCentavos } from "@/lib/money";

import { saveModelPriceFn } from "../finance.actions";
import { FINANCE_KEYS } from "../finance-keys";
import type { ModelPrice } from "../finance.types";

const pesosText = (centavos: number) => (centavos / 100).toFixed(2);

/**
 * Set what one AI model costs (price = null adds a model). Prices are pesos,
 * stored as centavos; they apply to calls made after the change.
 * The add dialog stays mounted, so it resets on every open.
 */
export function ModelPriceDialog({
  price,
  trigger,
  open,
  onOpenChange,
}: {
  price: ModelPrice | null;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [model, setModel] = useState(price?.model ?? "");
  const [input, setInput] = useState(price ? pesosText(price.inputCentavosPer1m) : "0.00");
  const [output, setOutput] = useState(price ? pesosText(price.outputCentavosPer1m) : "0.00");
  const [audio, setAudio] = useState(price ? pesosText(price.audioCentavosPerMinute) : "0.00");
  const [note, setNote] = useState(price?.note ?? "");
  const [innerOpen, setInnerOpen] = useState(false);

  /** Every open starts from the saved price, or empty for an add. */
  function reset() {
    setModel(price?.model ?? "");
    setInput(price ? pesosText(price.inputCentavosPer1m) : "0.00");
    setOutput(price ? pesosText(price.outputCentavosPer1m) : "0.00");
    setAudio(price ? pesosText(price.audioCentavosPerMinute) : "0.00");
    setNote(price?.note ?? "");
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
      title={price ? `Edit ${price.model}` : "Add model price"}
      description="What this model costs, so AI calls can be priced. Applies to calls made from now on."
      submitLabel="Save price"
      done="Price saved"
      onSubmit={async () => {
        if (model.trim() === "") return { ok: false as const, message: "Give the model a name." };
        const i = pesosToCentavos(input);
        const o = pesosToCentavos(output);
        const a = pesosToCentavos(audio);
        if (i === null || o === null || a === null) {
          return { ok: false as const, message: "Use pesos with up to two decimals." };
        }
        const res = await saveModelPriceFn({
          data: {
            model: model.trim(),
            inputCentavosPer1m: i,
            outputCentavosPer1m: o,
            audioCentavosPerMinute: a,
            note: note.trim() === "" ? null : note.trim(),
          },
        });
        if (res.ok) await queryClient.invalidateQueries({ queryKey: FINANCE_KEYS.prices });
        return res;
      }}
    >
      {(id) => (
        <>
          <Field label="Model" htmlFor={id("model")}>
            <Input
              id={id("model")}
              autoComplete="off"
              maxLength={80}
              value={model}
              readOnly={price !== null}
              onChange={(e) => setModel(e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Input, pesos per 1M tokens" htmlFor={id("input")}>
              <Input
                id={id("input")}
                inputMode="decimal"
                autoComplete="off"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
            </Field>
            <Field label="Output, pesos per 1M tokens" htmlFor={id("output")}>
              <Input
                id={id("output")}
                inputMode="decimal"
                autoComplete="off"
                value={output}
                onChange={(e) => setOutput(e.target.value)}
              />
            </Field>
            <Field label="Audio, pesos per minute" htmlFor={id("audio")}>
              <Input
                id={id("audio")}
                inputMode="decimal"
                autoComplete="off"
                value={audio}
                onChange={(e) => setAudio(e.target.value)}
              />
            </Field>
          </div>
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
