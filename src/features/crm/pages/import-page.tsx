import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { Field } from "@/components/shared/form";
import { BackLink } from "@/components/shared/links";
import { PageHeader, Surface } from "@/components/shared/page";
import { StatusChip } from "@/components/shared/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseCsv } from "@/lib/csv-parse";
import { cn } from "@/lib/utils";

import { findDuplicatesFn, importLeadsFn } from "../crm.actions";
import {
  buildImportRows,
  guessMapping,
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  type ImportField,
  type ImportMapping,
  type ImportRow,
} from "../crm.import";

const MAX_BYTES = 1024 * 1024;

const FIELD_LABEL: Record<ImportField, string> = {
  fullName: "Name",
  email: "Email",
  phone: "Phone",
  source: "Source",
  tags: "Tags",
  note: "Notes",
};

const selectClass =
  "h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11";

/**
 * Importing leads from a spreadsheet (FR-CRM-10, S-24): choose the file and
 * say how these people agreed to be contacted, match the columns, check the
 * rows, then import all of them or none.
 */
export function ImportPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [consent, setConsent] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function readFile(file: File | undefined) {
    setError(null);
    setRows(null);
    setTable(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError("The file is over 1 MB. Split it into smaller files.");
      return;
    }
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) {
      setError("The file has no rows under its header.");
      return;
    }
    setFileName(file.name);
    setTable(parsed);
    setMapping(guessMapping(parsed[0]));
  }

  async function checkRows() {
    if (!table) return;
    setBusy(true);
    setError(null);
    try {
      const draft = buildImportRows(table, mapping, []);
      const emails = draft.map((r) => r.input.email).filter((e): e is string => !!e);
      const phones = draft.map((r) => r.input.phone).filter((p): p is string => !!p);
      const res = await findDuplicatesFn({ data: { emails, phones } });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setRows(buildImportRows(table, mapping, res.matches));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong on our side. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const included = rows?.filter((r) => r.include) ?? [];
  const blocked = included.filter((r) => r.errors.length > 0);

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      const res = await importLeadsFn({
        data: { rows: included.map((r) => r.input), consentBasis: consent },
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      toast.success(`Imported ${res.imported} ${res.imported === 1 ? "lead" : "leads"}`);
      await queryClient.invalidateQueries({ queryKey: ["crm"] });
      await navigate({ to: "/crm" });
    } catch {
      setError("Something went wrong on our side. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const toggle = (line: number) =>
    setRows((rs) => rs?.map((r) => (r.line === line ? { ...r, include: !r.include } : r)) ?? null);

  return (
    <>
      <PageHeader
        back={<BackLink to="/crm">CRM</BackLink>}
        title="Import leads"
        description={`From a CSV file of up to ${MAX_IMPORT_ROWS} rows. Nothing is added until you import, and then either every row is added or none.`}
      />

      <div className="space-y-6">
        <Surface title="File and consent">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="CSV file" htmlFor="import-file">
              <Input
                id="import-file"
                type="file"
                accept=".csv,text/csv"
                className="h-auto py-2"
                onChange={(e) => void readFile(e.target.files?.[0])}
              />
            </Field>
            <Field
              label="How these people agreed to be contacted"
              htmlFor="import-consent"
              hint="Saved on every imported lead. Only import people who agreed to hear from Linara."
            >
              <Input
                id="import-consent"
                maxLength={300}
                placeholder="e.g. Signed up for updates at the Makati home expo"
                value={consent}
                onChange={(e) => setConsent(e.target.value)}
              />
            </Field>
          </div>
        </Surface>

        {table ? (
          <Surface
            title="Match the columns"
            description={`${table.length - 1} rows in ${fileName}. Name is needed; the rest are optional.`}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              {IMPORT_FIELDS.map((field) => (
                <div key={field} className="space-y-1.5">
                  <label
                    htmlFor={`map-${field}`}
                    className="text-xs font-semibold text-muted-foreground"
                  >
                    {FIELD_LABEL[field]} column
                  </label>
                  <select
                    id={`map-${field}`}
                    className={selectClass}
                    value={mapping[field] ?? ""}
                    onChange={(e) => {
                      setRows(null);
                      setMapping((m) => ({
                        ...m,
                        [field]: e.target.value === "" ? undefined : Number(e.target.value),
                      }));
                    }}
                  >
                    <option value="">Not in the file</option>
                    {table[0].map((header, i) => (
                      <option key={i} value={String(i)}>
                        {header || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <Button
              className="mt-5"
              disabled={busy || mapping.fullName === undefined || consent.trim().length < 5}
              onClick={() => void checkRows()}
            >
              {busy && !rows ? "Checking" : "Check rows"}
            </Button>
          </Surface>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-xl bg-status-late-soft px-3 py-2 text-sm text-status-late-ink"
          >
            {error}
          </p>
        ) : null}

        {rows ? (
          <Surface
            title="Check the rows"
            description="Duplicates are left out unless you include them. Rows with a problem must be fixed in the file or left out."
            flush
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-5 py-2 font-semibold sm:px-6">Include</th>
                    <th className="px-3 py-2 font-semibold">Line</th>
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 font-semibold">Email or phone</th>
                    <th className="px-3 py-2 font-semibold">Check</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.line} className={cn(!r.include && "text-muted-foreground")}>
                      <td className="px-5 py-2 sm:px-6">
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-pine"
                          aria-label={`Include line ${r.line}`}
                          checked={r.include}
                          onChange={() => toggle(r.line)}
                        />
                      </td>
                      <td className="px-3 py-2 tabular-nums">{r.line}</td>
                      <td className="max-w-48 truncate px-3 py-2">{r.input.fullName}</td>
                      <td className="max-w-56 truncate px-3 py-2">
                        {r.input.email || r.input.phone}
                      </td>
                      <td className="px-3 py-2">
                        {r.errors.length ? (
                          <span className="text-status-late-ink">{r.errors.join(" ")}</span>
                        ) : r.duplicateOf ? (
                          <StatusChip tone="attention">
                            {r.duplicateOf === "saved" ? "Already in the CRM" : "Twice in the file"}
                          </StatusChip>
                        ) : (
                          "Ready"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="text-sm text-muted-foreground">
                {blocked.length
                  ? `Fix or leave out the rows with a problem: ${blocked.length === 1 ? "line" : "lines"} ${blocked.map((r) => r.line).join(", ")}.`
                  : `${included.length} of ${rows.length} rows will be imported.`}
              </p>
              <Button
                disabled={busy || included.length === 0 || blocked.length > 0}
                onClick={() => void runImport()}
              >
                {busy
                  ? "Importing"
                  : `Import ${included.length} ${included.length === 1 ? "lead" : "leads"}`}
              </Button>
            </div>
          </Surface>
        ) : null}
      </div>
    </>
  );
}
