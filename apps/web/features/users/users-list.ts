import type { Role, User, UserPresence, UserStatus } from "@bitcrm/types";
import { isFieldTeamMember } from "@bitcrm/types";
import type { WzFilterGroup, WzFilterPick } from "@/components/workiz/filter-select";
import { personName } from "@/features/deals/person-name";
import { formatTeamCreated } from "@/features/technicians/team-list";
import { roleName } from "./lib";
import { overridesDiffer } from "./overrides";

/**
 * The Users list read the way Workiz's Team page reads its people
 * (`/root/team`, pg_technicians_wz_01_team) — the sibling of our Technicians
 * list: Name (with the email and a 2FA chip), Phone, Role, Field team, and
 * ours, Department; Created. Every account is in hand (the directory is a
 * team, hundreds not millions), so status, role, field team and department
 * filter together, as Workiz's do, where the paged endpoint takes one.
 */

/** One account, every cell the grid prints or filters on. */
export interface UserRow {
  id: string;
  name: string;
  email: string;
  phone?: string;
  twoFactor: boolean;
  roleId: string;
  role: string;
  fieldTeam: boolean;
  department: string;
  status: UserStatus;
  /** Ours: the account's permission overrides differ from its role's matrix. */
  custom: boolean;
  createdAt?: string;
  /** Ours: using the platform now (`GET /users/presence`). */
  online: boolean;
  /** When they last did — absent for someone who never has. */
  lastSeenAt?: string;
  user: User;
}

export function userRows(
  users: readonly User[],
  roles: readonly Role[] | undefined,
  presence?: ReadonlyMap<string, Pick<UserPresence, "online" | "lastSeenAt">>,
): UserRow[] {
  return users.map((u) => ({
    id: u.id,
    name: personName(u) ?? u.email,
    email: u.email,
    phone: u.phone || undefined,
    twoFactor: !!u.smsMfaEnabled,
    roleId: u.roleId,
    role: roleName(u.roleId, roles as Role[] | undefined),
    fieldTeam: isFieldTeamMember(u),
    department: u.department ?? "",
    status: u.status,
    custom: overridesDiffer(
      u.permissionOverrides,
      roles?.find((r) => r.id === u.roleId),
    ),
    createdAt: u.createdAt,
    online: !!presence?.get(u.id)?.online,
    lastSeenAt: presence?.get(u.id)?.lastSeenAt,
    user: u,
  }));
}

/**
 * The Last seen cell: "Online" while they are, then how long ago — minutes,
 * hours, days — and past a week the day and time as Created prints them.
 */
export function lastSeenLabel(row: Pick<UserRow, "online" | "lastSeenAt">, now: number = Date.now()): string {
  if (row.online) return "Online";
  if (!row.lastSeenAt) return "Never";
  const ago = Math.max(0, now - Date.parse(row.lastSeenAt));
  const minutes = Math.floor(ago / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return formatTeamCreated(row.lastSeenAt);
}

/** The status column of the filter, with Workiz's "All". */
const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "all", label: "All" },
];

/** Workiz's grid prints Field team as "yes" / "no". */
const FIELD_OPTIONS = [
  { value: "yes", label: "yes" },
  { value: "no", label: "no" },
];

/**
 * Filter results, column by column: the status column unheaded (its pick
 * reads "status: Active"), then Role, Field team and ours, Department and
 * Online. A column with nothing to offer is left out.
 */
export function userFilterGroups({
  roles,
  departments,
}: {
  roles: readonly { id: string; name: string }[];
  departments: readonly string[];
}): WzFilterGroup[] {
  const depts = [...new Set(departments.map((d) => d.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" }),
  );
  const groups: WzFilterGroup[] = [
    { id: "status", title: "", chipPrefix: "status", chipTone: "white", options: STATUS_OPTIONS },
    { id: "role", title: "Role", chipPrefix: "role", chipTone: "white", options: roles.map((r) => ({ value: r.id, label: r.name })) },
    { id: "field", title: "Field team", chipPrefix: "field team", chipTone: "white", options: FIELD_OPTIONS },
    { id: "department", title: "Department", chipPrefix: "department", chipTone: "white", options: depts.map((d) => ({ value: d, label: d })) },
    // Ours: who is using the platform now.
    { id: "online", title: "Online", chipPrefix: "online", chipTone: "white", options: FIELD_OPTIONS },
  ];
  return groups.filter((g) => g.options.length > 0);
}

/** Workiz's Team opens on "status: Active". */
export const DEFAULT_USER_FILTER: WzFilterPick[] = [{ group: "status", value: "active" }];

/** The rows the picks leave: within a column any pick will do, across columns every column must agree. */
export function filterUsers(rows: readonly UserRow[], picks: readonly WzFilterPick[]): UserRow[] {
  const by = (group: string) => picks.filter((p) => p.group === group).map((p) => p.value);
  const status = by("status");
  const role = by("role");
  const field = by("field");
  const dept = by("department");
  const online = by("online");
  return rows.filter(
    (r) =>
      (!status.length || status.some((s) => s === "all" || s === r.status)) &&
      (!role.length || role.includes(r.roleId)) &&
      (!field.length || field.includes(r.fieldTeam ? "yes" : "no")) &&
      (!dept.length || dept.includes(r.department)) &&
      (!online.length || online.includes(r.online ? "yes" : "no")),
  );
}

/**
 * Search as the server's was (user-service `matchesSearch`): every word must
 * appear in the name, email, department or phone — a word of digits (with
 * the phone's own punctuation) also in the phone's digits.
 */
export function searchUsers(rows: readonly UserRow[], query: string): UserRow[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...rows];
  // "(505) 555" is one phone number typed with a space: try the whole query as digits too.
  const whole = query.replace(/[\s()+.-]/g, "");
  return rows.filter((r) => {
    const hay = [r.name, r.user.firstName, r.user.lastName, r.email, r.department, r.phone].filter(Boolean).join(" ").toLowerCase();
    const digits = (r.phone ?? "").replace(/\D/g, "");
    const inPhone = (t: string) => {
      const d = t.replace(/\D/g, "");
      return d.length >= 3 && d === t.replace(/[\s()+.-]/g, "") && digits.includes(d);
    };
    if (/^\d{3,}$/.test(whole) && digits.includes(whole)) return true;
    return terms.every((t) => hay.includes(t) || inPhone(t));
  });
}
