import type { Role } from "@bitcrm/types";
import { systemRoleName } from "@/lib/permissions/system-roles";

export function roleName(roleId: string, roles: Role[] | undefined): string {
  return (
    roles?.find((r) => r.id === roleId)?.name ??
    systemRoleName(roleId) ??
    roleId
  );
}

export function initials(first?: string, last?: string): string {
  return `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase() || "U";
}

export function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
