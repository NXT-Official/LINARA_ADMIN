import { useState, type ReactNode } from "react";

import { Field, FormDialog } from "@/components/shared/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { saveFaqFn } from "../faq.actions";
import { DEFAULT_CATEGORY, FAQ_LIMITS, type FaqEntry } from "../faq.types";

/** Writing or editing one FAQ. Saving replaces the whole entry, so every field is sent. */
export function FaqDialog({
  trigger,
  entry,
  categories,
  onSaved,
}: {
  trigger: ReactNode;
  entry?: FaqEntry;
  categories: string[];
  onSaved: () => Promise<void> | void;
}) {
  const [question, setQuestion] = useState(entry?.question ?? "");
  const [answer, setAnswer] = useState(entry?.answer ?? "");
  const [category, setCategory] = useState(entry?.category ?? DEFAULT_CATEGORY);
  const [order, setOrder] = useState(String(entry?.sortOrder ?? 0));
  const [published, setPublished] = useState(entry?.published ?? false);
  const sortOrder = Number(order);
  const orderOk = order.trim() !== "" && Number.isInteger(sortOrder);
  return (
    <FormDialog
      trigger={trigger}
      title={entry ? "Edit FAQ" : "New FAQ"}
      description="Published questions show on the public Help page. Drafts stay here."
      submitLabel={entry ? "Save FAQ" : "Add FAQ"}
      done={entry ? "FAQ saved" : "FAQ added"}
      canSubmit={question.trim().length > 0 && answer.trim().length > 0 && orderOk}
      onSubmit={async () => {
        const res = await saveFaqFn({
          data: {
            ...(entry ? { id: entry.id } : {}),
            question,
            answer,
            category,
            sortOrder,
            published,
          },
        });
        if (!res.ok) return res;
        if (!entry) {
          setQuestion("");
          setAnswer("");
          setOrder("0");
          setPublished(false);
        }
        await onSaved();
        return { ok: true as const };
      }}
    >
      {(id) => (
        <>
          <Field label="Question" htmlFor={id("question")}>
            <Input
              id={id("question")}
              required
              autoComplete="off"
              maxLength={FAQ_LIMITS.question}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </Field>
          <Field label="Answer" htmlFor={id("answer")}>
            <Textarea
              id={id("answer")}
              rows={6}
              required
              maxLength={FAQ_LIMITS.answer}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Category"
              htmlFor={id("category")}
              hint="Questions with the same category are grouped together."
            >
              <Input
                id={id("category")}
                autoComplete="off"
                list={id("categories")}
                maxLength={FAQ_LIMITS.category}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              <datalist id={id("categories")}>
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="Sort order" htmlFor={id("order")} hint="Lower numbers come first.">
              <Input
                id={id("order")}
                type="number"
                step={1}
                inputMode="numeric"
                value={order}
                onChange={(e) => setOrder(e.target.value)}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
            />
            Published on the public Help page
          </label>
        </>
      )}
    </FormDialog>
  );
}
