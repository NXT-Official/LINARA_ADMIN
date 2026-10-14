import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { recordExportFn } from "@/features/audit/audit.actions";
import { csvFilename, downloadCsv, toCsv, type CsvColumn } from "@/lib/csv";
import { cn } from "@/lib/utils";

/**
 * One click, one CSV of what's on screen. These exports carry ids, dates,
 * stages and counts, never names, contact details, free text or pay amounts
 * (spec FR-EX-1), which is why they need no two-step code. Each one is
 * recorded in the audit log first, and doesn't run if it can't be (FR-EX-3).
 */
export function ExportCsvButton<T>({
  slug,
  columns,
  rows,
  label = "Export CSV",
  size = "default",
  className,
}: {
  /** Names the file: linara-<slug>-<date>.csv */
  slug: string;
  columns: CsvColumn<T>[];
  rows: T[];
  label?: string;
  size?: "default" | "sm";
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="outline"
      size={size}
      className={cn(className)}
      disabled={rows.length === 0 || pending}
      onClick={async () => {
        setPending(true);
        try {
          const res = await recordExportFn({ data: { slug, rows: rows.length } });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
        } catch {
          toast.error("The export couldn't be recorded, so it didn't run. Try again.");
          return;
        } finally {
          setPending(false);
        }
        const name = csvFilename(slug);
        downloadCsv(name, toCsv(columns, rows));
        toast.success("CSV downloaded", {
          description: `${name}, ${rows.length} ${rows.length === 1 ? "row" : "rows"}. No names or contact details.`,
        });
      }}
    >
      <Download />
      {label}
    </Button>
  );
}
