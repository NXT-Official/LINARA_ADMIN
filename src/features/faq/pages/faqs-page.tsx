import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, Surface } from "@/components/shared/page";
import { FormDialog } from "@/components/shared/form";
import { EmptyState } from "@/components/shared/states";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { FaqDialog } from "../components/faq-dialog";
import { deleteFaqFn, listFaqsFn, saveFaqFn } from "../faq.actions";
import type { FaqEntry } from "../faq.types";

const FAQ_KEY = ["faqs"] as const;

function groupByCategory(faqs: FaqEntry[]): [string, FaqEntry[]][] {
  const groups = new Map<string, FaqEntry[]>();
  for (const f of faqs) groups.set(f.category, [...(groups.get(f.category) ?? []), f]);
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, rows]) => [
      category,
      [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.question.localeCompare(b.question)),
    ]);
}

function DeleteFaqDialog({ entry, onDone }: { entry: FaqEntry; onDone: () => Promise<void> }) {
  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline">
          Delete
        </Button>
      }
      title="Delete this FAQ"
      description={`"${entry.question}" is removed for good, and the public Help page stops showing it. Unpublish it instead if you may want it back.`}
      submitLabel="Delete FAQ"
      done="FAQ deleted"
      destructive
      onSubmit={async () => {
        const res = await deleteFaqFn({ data: { id: entry.id } });
        if (!res.ok) return res;
        await onDone();
        return { ok: true as const };
      }}
    >
      {null}
    </FormDialog>
  );
}

/** The questions the public Help page answers, grouped by category. */
export function FaqsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: FAQ_KEY, queryFn: () => listFaqsFn() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: FAQ_KEY });
  const faqs = useMemo(() => (query.data?.ok ? query.data.faqs : []), [query.data]);
  const groups = useMemo(() => groupByCategory(faqs), [faqs]);
  const categories = useMemo(() => groups.map(([c]) => c), [groups]);

  async function change(entry: FaqEntry, published: boolean) {
    try {
      const res = await saveFaqFn({
        data: {
          id: entry.id,
          question: entry.question,
          answer: entry.answer,
          category: entry.category,
          sortOrder: entry.sortOrder,
          published,
        },
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      await refresh();
      toast.success(published ? "FAQ published" : "FAQ unpublished");
    } catch {
      toast.error("Something went wrong on our side. Try again.");
    }
  }

  const newButton = (
    <FaqDialog
      categories={categories}
      onSaved={refresh}
      trigger={
        <Button>
          <Plus />
          New FAQ
        </Button>
      }
    />
  );

  return (
    <>
      <PageHeader
        title="FAQs"
        description="Questions and answers for the public Help page. Only published ones show there."
        actions={newButton}
      />
      {query.isPending ? (
        <Surface>
          <div className="space-y-3" role="status" aria-label="Loading FAQs">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </Surface>
      ) : query.isError || !query.data.ok ? (
        <Surface>
          <EmptyState title="The FAQs didn't load">
            {query.data && !query.data.ok
              ? query.data.message
              : "Something went wrong on our side. Try again."}
          </EmptyState>
        </Surface>
      ) : groups.length === 0 ? (
        <Surface>
          <EmptyState title="No FAQs yet">
            Add the first question people ask and publish it to the Help page.
          </EmptyState>
        </Surface>
      ) : (
        <div className="space-y-4">
          {groups.map(([category, rows]) => (
            <Surface key={category} title={category} flush>
              <ul className="divide-y divide-border">
                {rows.map((f) => (
                  <li
                    key={f.id}
                    className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold break-words text-foreground">
                        {f.question}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <StatusChip tone={f.published ? "done" : "neutral"}>
                          {f.published ? "Published" : "Draft"}
                        </StatusChip>
                        <span>Order {f.sortOrder}</span>
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:shrink-0">
                      <FaqDialog
                        entry={f}
                        categories={categories}
                        onSaved={refresh}
                        trigger={
                          <Button size="sm" variant="outline">
                            Edit
                          </Button>
                        }
                      />
                      <Button size="sm" variant="outline" onClick={() => change(f, !f.published)}>
                        {f.published ? "Unpublish" : "Publish"}
                      </Button>
                      <DeleteFaqDialog entry={f} onDone={refresh} />
                    </div>
                  </li>
                ))}
              </ul>
            </Surface>
          ))}
        </div>
      )}
    </>
  );
}
