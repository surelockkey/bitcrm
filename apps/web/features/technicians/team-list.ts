import type {
  TechnicianJobType,
  TechnicianProfile,
  TechnicianProfileStatus,
  TechnicianServiceArea,
  TechnicianType,
  User,
} from "@bitcrm/types";
import { isFieldTeamMember } from "@bitcrm/types";
import type { WzFilterGroup, WzFilterPick } from "@/components/workiz/filter-select";
import { personName } from "@/features/deals/person-name";
import { DEFAULT_TZ } from "@/lib/timezone";

/**
 * The technicians list as Workiz's Team page reads it (`/root/team`,
 * pg_technicians_wz_01_team): Name (with the email and a 2FA chip), Phone
 * (with a "Call masking" chip), Role, Field team, Type, Created, Skills,
 * Areas — and its Filter results: status, Role, User type, Service area.
 */

/** One technician, every cell the list prints or filters on. */
export interface TeamRow {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  twoFactor: boolean;
  callMasking: boolean;
  roleId?: string;
  /** The role's name ("tech", "dispatch"); blank when the viewer may not read roles. */
  role: string;
  fieldTeam: boolean;
  type: TechnicianType;
  /** Ours, not Workiz's: pending (awaiting setup) / active / inactive. */
  status: TechnicianProfileStatus;
  createdAt?: string;
  /** Approved job types — Workiz's "Skills". */
  skills: string[];
  areaIds: string[];
  areas: string[];
}

/** Every technician's approved entries (`GET /users/technicians/assignments/approved`). */
export interface ApprovedAssignments {
  jobTypes: Pick<TechnicianJobType, "userId" | "jobTypeId" | "status">[];
  serviceAreas: Pick<TechnicianServiceArea, "userId" | "serviceAreaId" | "status">[];
}

export const NO_APPROVED: ApprovedAssignments = { jobTypes: [], serviceAreas: [] };

export function teamRows(
  profiles: readonly TechnicianProfile[],
  {
    users,
    roles,
    approved,
    jobTypeName,
    areaName,
  }: {
    users: Map<string, User>;
    roles: readonly { id: string; name: string }[];
    approved: ApprovedAssignments;
    jobTypeName: (id: string) => string;
    areaName: (id: string) => string;
  },
): TeamRow[] {
  const roleName = new Map(roles.map((r) => [r.id, r.name] as const));
  const skillsOf = new Map<string, string[]>();
  for (const j of approved.jobTypes) {
    if (j.status !== "approved") continue;
    skillsOf.set(j.userId, [...(skillsOf.get(j.userId) ?? []), j.jobTypeId]);
  }
  const areasOf = new Map<string, string[]>();
  for (const a of approved.serviceAreas) {
    if (a.status !== "approved") continue;
    areasOf.set(a.userId, [...(areasOf.get(a.userId) ?? []), a.serviceAreaId]);
  }

  return profiles.map((p) => {
    const u = users.get(p.userId);
    const areaIds = areasOf.get(p.userId) ?? [];
    return {
      id: p.userId,
      name: personName(u) ?? "Unknown technician",
      email: u?.email,
      phone: u?.phone ?? p.phone,
      twoFactor: !!u?.smsMfaEnabled,
      callMasking: !!p.callMaskingEnabled,
      roleId: u?.roleId,
      role: (u?.roleId && roleName.get(u.roleId)) || "",
      // Unknown person: a technician profile is on the field team until switched off.
      fieldTeam: u ? isFieldTeamMember(u) : true,
      type: p.technicianType ?? "regular",
      status: p.status,
      createdAt: u?.createdAt ?? p.createdAt,
      skills: (skillsOf.get(p.userId) ?? []).map(jobTypeName),
      areaIds,
      areas: areaIds.map(areaName),
    };
  });
}

const CREATED = new Map<string, Intl.DateTimeFormat>();

/**
 * Workiz's Created cell: "Fri Nov 04, 2022 07:16 am" — the weekday, a
 * two-digit day, a 12-hour clock with a lower-case am/pm — in the business's
 * zone, as Workiz prints it in the account's.
 */
export function formatTeamCreated(iso: string | undefined, tz: string = DEFAULT_TZ): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  let fmt = CREATED.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    CREATED.set(tz, fmt);
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => fmt.formatToParts(d).find((p) => p.type === type)?.value ?? "";
  const hour = part("hour").padStart(2, "0");
  return `${part("weekday")} ${part("month")} ${part("day")}, ${part("year")} ${hour}:${part("minute")} ${part("dayPeriod").toLowerCase()}`;
}

/** The status column of the filter: ours, with Workiz's "All". */
const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "inactive", label: "Inactive" },
  { value: "all", label: "All" },
];

/** Workiz's "User type": our regular technician is their "User". */
export const TEAM_TYPE_LABEL: Record<TechnicianType, string> = {
  regular: "User",
  subcontractor: "Subcontractor",
};

/**
 * Filter results, column by column (pg_technicians_wz_04_filter_open): the
 * status column has no heading and prints its pick white ("status: Active"),
 * then ROLE, USER TYPE, SERVICE AREA. A column with nothing to offer is left
 * out (no roles for a viewer who may not read them).
 */
export function teamFilterGroups({
  roles,
  areas,
}: {
  roles: readonly { id: string; name: string }[];
  areas: readonly { id: string; name: string }[];
}): WzFilterGroup[] {
  const groups: WzFilterGroup[] = [
    { id: "status", title: "", chipPrefix: "status", chipTone: "white", options: STATUS_OPTIONS },
    { id: "role", title: "Role", chipPrefix: "role", chipTone: "white", options: roles.map((r) => ({ value: r.id, label: r.name })) },
    {
      id: "type",
      title: "User type",
      chipPrefix: "type",
      chipTone: "white",
      options: (Object.keys(TEAM_TYPE_LABEL) as TechnicianType[]).map((t) => ({ value: t, label: TEAM_TYPE_LABEL[t] })),
    },
    { id: "area", title: "Service area", chipPrefix: "area", chipTone: "white", options: areas.map((a) => ({ value: a.id, label: a.name })) },
  ];
  return groups.filter((g) => g.options.length > 0);
}

/** Workiz's Team opens on "status: Active". */
export const DEFAULT_TEAM_FILTER: WzFilterPick[] = [{ group: "status", value: "active" }];

/**
 * Whether a status pick takes a row. "Active" is Workiz's sense — not switched
 * off — so it holds a technician still awaiting setup (ours: pending): in
 * Workiz a newly added user is Active at once, and a manager looking for the
 * person they just added must find them on the list as it opens.
 */
function statusTakes(pick: string, status: TechnicianProfileStatus): boolean {
  if (pick === "all") return true;
  if (pick === "active") return status !== "inactive";
  return pick === status;
}

/** The rows the picks leave: within a column any pick will do, across columns every column must agree. */
export function filterTeam(rows: readonly TeamRow[], picks: readonly WzFilterPick[]): TeamRow[] {
  const by = (group: string) => picks.filter((p) => p.group === group).map((p) => p.value);
  const status = by("status");
  const role = by("role");
  const type = by("type");
  const area = by("area");
  return rows.filter(
    (r) =>
      (!status.length || status.some((s) => statusTakes(s, r.status))) &&
      (!role.length || (!!r.roleId && role.includes(r.roleId))) &&
      (!type.length || type.includes(r.type)) &&
      (!area.length || r.areaIds.some((a) => area.includes(a))),
  );
}
