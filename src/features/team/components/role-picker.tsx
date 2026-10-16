import type { RoleRow } from "../roles.types";

const selectClass =
  "h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11";

/** Only the roles the person choosing may give (D39); the server checks again. */
export function RolePicker({
  id,
  roles,
  value,
  onChange,
}: {
  id: string;
  roles: RoleRow[];
  value: string;
  onChange: (roleId: string) => void;
}) {
  return (
    <select
      id={id}
      className={selectClass}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {roles.map((r) => (
        <option key={r.roleId} value={r.roleId}>
          {r.name}
        </option>
      ))}
    </select>
  );
}
