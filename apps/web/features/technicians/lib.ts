import type {
  TechnicianProfileStatus,
  TechnicianJobType,
  TechnicianServiceArea,
  AssignmentStatus,
  DocumentType,
  OnboardingStatus,
  User,
} from "@bitcrm/types";
import type { DirectoryUser } from "@/features/deals/hooks";

export { formatMoney } from "@/features/inventory/products/lib";

/* ---- Onboarding ---- */

export function onboardingPct(o: Pick<OnboardingStatus, "completedSteps" | "totalSteps">): number {
  if (!o.totalSteps) return 0;
  return Math.round((o.completedSteps / o.totalSteps) * 100);
}

/* ---- User join (technician profiles store no name/email) ---- */

/**
 * `self` covers viewers who can't fetch the user map at all (technicians have
 * no `users.view`): their own record is still resolvable from `me`.
 */
export function techUser(
  userId: string,
  map: Map<string, DirectoryUser>,
  self?: User | null,
): DirectoryUser | undefined {
  return map.get(userId) ?? (self && self.id === userId ? self : undefined);
}

function userLabel(u: DirectoryUser): string {
  const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
  // `email` is absent for a viewer who may not list users; the id is the
  // honest last resort rather than an empty label.
  return name || u.email || u.id;
}

export function techName(
  userId: string,
  map: Map<string, DirectoryUser>,
  self?: User | null,
): string {
  const u = techUser(userId, map, self);
  return u ? userLabel(u) : "Unknown technician";
}

/**
 * Audit actors are any staff member (often an admin), and rows written before
 * the `custom:user_id` claim backfill may have no actor at all.
 */
export function actorName(actorId: string | undefined, map: Map<string, DirectoryUser>): string {
  if (!actorId) return "Unknown user";
  if (actorId === "system") return "System";
  const u = map.get(actorId);
  return u ? userLabel(u) : "Unknown user";
}

/**
 * Prefer the server-resolved `actorName` (works without `users.view`); the
 * client-side join stays as a fallback for older backends.
 */
export function auditActorLabel(
  r: { actorId?: string; actorName?: string },
  map: Map<string, DirectoryUser>,
): string {
  return r.actorName || actorName(r.actorId, map);
}

/* ---- Assignments ---- */

/** Approved catalog ids of one kind. */
export function approvedJobTypeIds(jobTypes: TechnicianJobType[]): string[] {
  return jobTypes.filter((j) => j.status === "approved").map((j) => j.jobTypeId);
}
export function approvedServiceAreaIds(areas: TechnicianServiceArea[]): string[] {
  return areas.filter((a) => a.status === "approved").map((a) => a.serviceAreaId);
}

/** A technician is assignable with ≥1 approved job type AND service area. */
export function isAssignable(
  jobTypes: TechnicianJobType[],
  serviceAreas: TechnicianServiceArea[],
): boolean {
  return (
    jobTypes.some((j) => j.status === "approved") &&
    serviceAreas.some((a) => a.status === "approved")
  );
}

/* ---- Labels ---- */

const STATUS_LABELS: Record<TechnicianProfileStatus, string> = {
  pending: "Pending",
  active: "Active",
  inactive: "Inactive",
};
export function statusLabel(s: TechnicianProfileStatus): string {
  return STATUS_LABELS[s] ?? s;
}

const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};
export function assignmentStatusLabel(s: AssignmentStatus): string {
  return ASSIGNMENT_STATUS_LABELS[s] ?? s;
}

export function formatPct(n: number): string {
  return `${n}%`;
}

/* ---- Documents ---- */

export const DOC_TYPES: DocumentType[] = [
  "drivers_license_front",
  "drivers_license_back",
  "profile_photo",
  "bank_document",
];

export const DOC_LABELS: Record<DocumentType, string> = {
  drivers_license_front: "License · front",
  drivers_license_back: "License · back",
  profile_photo: "Profile photo",
  bank_document: "Bank document",
};

export function docLabel(t: DocumentType): string {
  return DOC_LABELS[t] ?? t;
}

/* ---- Audit ---- */

const AUDIT_LABELS: Record<string, string> = {
  "document.uploaded": "Uploaded a document",
  "document.viewed": "Viewed a document",
  "document.deleted": "Deleted a document",
  "sensitive.updated": "Updated sensitive data",
  "sensitive.read": "Read sensitive data",
};
export function auditLabel(action: string): string {
  return AUDIT_LABELS[action] ?? action;
}
