import { isSubcontractor, type Role, type User } from "@bitcrm/types";
import { systemRoleName } from "@/lib/permissions/system-roles";
import { DEFAULT_TZ } from "@/lib/timezone";

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

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Oct 12, 2026" — the day of an instant on Connecticut's calendar, whatever
 * the browser's (2026-10-12 owner rule; a day carries no time, so no zone
 * label). A bare "YYYY-MM-DD" is already a day and is printed as it is —
 * read as an instant it would be UTC midnight, the evening before in
 * Connecticut. "—" for nothing or nonsense.
 */
export function formatDate(iso?: string): string {
  if (!iso) return "—";
  const dayOnly = DAY_ONLY.test(iso);
  const d = new Date(dayOnly ? `${iso}T00:00:00.000Z` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    timeZone: dayOnly ? "UTC" : DEFAULT_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** What the "+ Add New" toast says: a User was invited; a subcontractor, who cannot sign in, was only added. */
export function createdUserMessage(u: Pick<User, "email" | "firstName" | "lastName" | "userType">): string {
  return isSubcontractor(u) ? `${u.firstName} ${u.lastName} added as a subcontractor` : `Invite sent to ${u.email}`;
}
