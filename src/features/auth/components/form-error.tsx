/** A form's error, announced to screen readers. Plain text only (S-15). */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-xl bg-status-late-soft px-3 py-2 text-sm text-status-late-ink"
    >
      {message}
    </p>
  );
}
