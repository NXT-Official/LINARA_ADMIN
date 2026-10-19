import { useId, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

import { useT } from "@/lib/i18n/i18n";
import { sampleToast } from "@/lib/sample-toast";

/** A labelled field. The label sits above, sentence case (LINARA DESIGN.md, Inputs). */
export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-semibold text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function SelectField<V extends string>({
  id,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  value: V | "";
  onChange: (value: V) => void;
  options: { value: V; label: string }[];
  placeholder?: string;
}) {
  const t = useT();
  return (
    <Select value={value || undefined} onValueChange={(v) => onChange(v as V)}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder ?? t("form.choose")} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A dialog holding one form. The submit button names the action; the toast
 * after it uses the same words (`done`).
 */
export function FormDialog({
  trigger,
  title,
  description,
  submitLabel,
  done,
  destructive = false,
  canSubmit = true,
  children,
  open: openProp,
  onOpenChange,
  onSubmit,
}: {
  /**
   * The real action. Resolves `{ ok: true }` to close with the `done` toast, or
   * `{ ok: false, message }` to stay open and show the message. Omitted, the
   * dialog only confirms with the sample-data toast.
   */
  onSubmit?: () => Promise<{ ok: true; done?: string } | { ok: false; message: string }>;
  /** Omit when a menu item opens the dialog; pass `open` and `onOpenChange` instead. */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  submitLabel: string;
  done: string;
  destructive?: boolean;
  canSubmit?: boolean;
  children: ReactNode | ((id: (name: string) => string) => ReactNode);
}) {
  const t = useT();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean) => {
    setOpenState(v);
    onOpenChange?.(v);
  };
  const base = useId();
  const id = (name: string) => `${base}-${name}`;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!onSubmit) {
      setOpen(false);
      sampleToast(done);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await onSubmit();
      if (res.ok) {
        setOpen(false);
        toast.success(res.done ?? done);
      } else {
        setError(res.message);
      }
    } catch {
      setError(t("common.unexpectedError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        // Tapping outside doesn't throw away a half-filled form (LINARA DESIGN.md, Modals).
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="font-display text-xl font-normal">{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {typeof children === "function" ? children(id) : children}
          {error ? (
            <p
              role="alert"
              className="rounded-xl bg-status-late-soft px-3 py-2 text-sm text-status-late-ink"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter className="gap-2 pt-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("form.cancel")}
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={!canSubmit || pending}
            >
              {pending ? t("form.working") : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
