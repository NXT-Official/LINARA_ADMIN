import { Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { csvFilename, downloadCsv, toCsv, type CsvColumn } from "@/lib/csv";
import { cn } from "@/lib/utils";

/**
 * One click, one CSV of what's on screen. These exports carry ids, dates,
 * stages and counts, never names, contact details, free text or pay amounts
 * (spec FR-EX-1), which is why they need no two-step code. Phase 1 records
 * each one in the audit log (NFR-9).
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
  return (
    <Button
      variant="outline"
      size={size}
      className={cn(className)}
      disabled={rows.length === 0}
      onClick={() => {
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
