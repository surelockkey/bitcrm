import type {
  TechnicianProfileStatus,
  TechnicianSkill,
  SkillType,
  SkillStatus,
  DocumentType,
  OnboardingStatus,
  User,
} from "@bitcrm/types";

export { formatMoney } from "@/features/inventory/products/lib";

/* ---- Onboarding ---- */

export function onboardingPct(o: Pick<OnboardingStatus, "completedSteps" | "totalSteps">): number {
  if (!o.totalSteps) return 0;
  return Math.round((o.completedSteps / o.totalSteps) * 100);
}

/* ---- User join (technician profiles store no name/email) ---- */

export function techUser(userId: string, map: Map<string, User>): User | undefined {
  return map.get(userId);
}

export function techName(userId: string, map: Map<string, User>): string {
  const u = map.get(userId);
  if (!u) return "Unknown technician";
  const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
  return name || u.email;
}

/* ---- Skills ---- */

export function groupSkills(skills: TechnicianSkill[]) {
  return {
    jobTypes: skills.filter((s) => s.type === "job_type"),
    serviceAreas: skills.filter((s) => s.type === "service_area"),
  };
}

export function approvedValues(skills: TechnicianSkill[], type: SkillType): string[] {
  return skills.filter((s) => s.type === type && s.status === "approved").map((s) => s.value);
}

/** A technician is assignable with ≥1 approved job type AND service area. */
export function isAssignable(skills: TechnicianSkill[]): boolean {
  const hasJob = skills.some((s) => s.type === "job_type" && s.status === "approved");
  const hasArea = skills.some((s) => s.type === "service_area" && s.status === "approved");
  return hasJob && hasArea;
}

/** Common job types offered as free-text suggestions when proposing. */
export const JOB_TYPE_SUGGESTIONS = [
  "Lockout",
  "Rekey",
  "Lock Change",
  "Installation",
  "Repair",
  "Safe",
  "Automotive",
  "Commercial",
  "Other",
] as const;

/* ---- Labels ---- */

const STATUS_LABELS: Record<TechnicianProfileStatus, string> = {
  pending: "Pending",
  active: "Active",
  inactive: "Inactive",
};
export function statusLabel(s: TechnicianProfileStatus): string {
  return STATUS_LABELS[s] ?? s;
}

const SKILL_STATUS_LABELS: Record<SkillStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};
export function skillStatusLabel(s: SkillStatus): string {
  return SKILL_STATUS_LABELS[s] ?? s;
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
