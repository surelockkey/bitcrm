import type {
  TechnicianProfile,
  TechnicianProfileStatus,
  TechnicianHomeAddress,
  TechnicianLocation,
  OnboardingStatus,
  TechnicianJobType,
  TechnicianServiceArea,
  CommissionConfig,
  CommissionBreakdown,
  DocumentType,
  User,
  PaginatedResponse,
} from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";

const BASE = "/users/technicians";

/* ---- Local response/request shapes (not in @bitcrm/types) ---- */

export interface DocumentMeta {
  docType: DocumentType;
  contentType: string;
  uploadedAt: string;
}
export interface SensitiveView {
  ssn: string | null;
  bankAccount: string | null;
  masked: boolean;
}
export interface AuditRecord {
  userId: string;
  actorId: string;
  action: string;
  resource: string;
  timestamp: string;
}
export interface UpdateProfileBody {
  phone?: string;
  homeAddress?: TechnicianHomeAddress;
  profilePhotoUrl?: string;
  laborCostPerHour?: number;
  callMaskingEnabled?: boolean;
  gpsTrackingEnabled?: boolean;
  mobileAppInstalled?: boolean;
  status?: TechnicianProfileStatus;
}
/** A technician's job types + service areas with their review statuses. */
export interface TechnicianAssignments {
  jobTypes: TechnicianJobType[];
  serviceAreas: TechnicianServiceArea[];
}

/** The manager review queue, split by kind. */
export interface PendingAssignments {
  jobTypes: TechnicianJobType[];
  serviceAreas: TechnicianServiceArea[];
}
export interface SetCommissionBody {
  baseRatePct: number;
  creditCardFeePct?: number;
  achFeePct?: number;
  effectiveDate?: string;
}
export interface CalculateCommissionQuery {
  revenue: number;
  tax: number;
  partsCost: number;
  paidByCard: boolean;
}
export interface SetSensitiveBody {
  ssn?: string;
  bankAccount?: string;
}

/* ---- Profile / onboarding ---- */

export function listTechnicians(
  status?: string,
  cursor?: string,
): Promise<PaginatedResponse<TechnicianProfile>> {
  const q = new URLSearchParams({ limit: "100" });
  if (status) q.set("status", status);
  if (cursor) q.set("cursor", cursor);
  return apiFetchPaginated<TechnicianProfile>(`${BASE}?${q}`);
}

export function getProfile(id: string): Promise<TechnicianProfile> {
  return http.get<TechnicianProfile>(`${BASE}/${id}/profile`);
}

export function updateProfile(id: string, body: UpdateProfileBody): Promise<TechnicianProfile> {
  return http.put<TechnicianProfile>(`${BASE}/${id}/profile`, body);
}

export function getOnboarding(id: string): Promise<OnboardingStatus> {
  return http.get<OnboardingStatus>(`${BASE}/${id}/onboarding-status`);
}

/* ---- Assignments (job types + service areas) ----
 * Both share one review flow; the route segment picks the catalog. `kind` maps
 * to the URL: 'job_type' → /job-types, 'service_area' → /service-areas.
 */

export type AssignmentKind = "job_type" | "service_area";
const seg = (kind: AssignmentKind) => (kind === "job_type" ? "job-types" : "service-areas");

export function getAssignments(id: string): Promise<TechnicianAssignments> {
  return http.get<TechnicianAssignments>(`${BASE}/${id}/assignments`);
}

export function listPendingAssignments(): Promise<PendingAssignments> {
  return http.get<PendingAssignments>(`${BASE}/assignments/pending`);
}

export function proposeAssignments(id: string, kind: AssignmentKind, ids: string[]) {
  return http.post(`${BASE}/${id}/${seg(kind)}/propose`, { ids });
}

/** Manager path: grant catalog entries directly (pre-approved), skipping propose. */
export function assignDirect(id: string, kind: AssignmentKind, ids: string[]) {
  return http.post(`${BASE}/${id}/${seg(kind)}`, { ids });
}

export function approveAssignment(id: string, kind: AssignmentKind, catalogId: string, comments?: string) {
  return http.post(`${BASE}/${id}/${seg(kind)}/${catalogId}/approve`, { comments });
}

export function rejectAssignment(id: string, kind: AssignmentKind, catalogId: string, comments: string) {
  return http.post(`${BASE}/${id}/${seg(kind)}/${catalogId}/reject`, { comments });
}

export function revokeAssignment(id: string, kind: AssignmentKind, catalogId: string): Promise<null> {
  return http.delete<null>(`${BASE}/${id}/${seg(kind)}/${catalogId}`);
}

/* ---- Commission ---- */

export function getCommission(id: string): Promise<CommissionConfig> {
  return http.get<CommissionConfig>(`${BASE}/${id}/commission`);
}

export function getCommissionHistory(id: string): Promise<CommissionConfig[]> {
  return http.get<CommissionConfig[]>(`${BASE}/${id}/commission/history`);
}

export function calculateCommission(
  id: string,
  q: CalculateCommissionQuery,
): Promise<CommissionBreakdown> {
  const p = new URLSearchParams({
    revenue: String(q.revenue),
    tax: String(q.tax),
    partsCost: String(q.partsCost),
    paidByCard: String(q.paidByCard),
  });
  return http.get<CommissionBreakdown>(`${BASE}/${id}/commission/calculate?${p}`);
}

export function setCommission(id: string, body: SetCommissionBody): Promise<CommissionConfig> {
  return http.post<CommissionConfig>(`${BASE}/${id}/commission`, body);
}

/* ---- Documents + sensitive + audit ---- */

export function listDocuments(id: string): Promise<DocumentMeta[]> {
  return http.get<DocumentMeta[]>(`${BASE}/${id}/documents`);
}

export function getDocumentDownloadUrl(
  id: string,
  docType: DocumentType,
): Promise<{ downloadUrl: string }> {
  return http.get<{ downloadUrl: string }>(`${BASE}/${id}/documents/${docType}`);
}

export function getDocumentUploadUrl(
  id: string,
  docType: DocumentType,
  contentType: string,
): Promise<{ uploadUrl: string; s3Key: string; headers?: Record<string, string> }> {
  return http.post<{ uploadUrl: string; s3Key: string; headers?: Record<string, string> }>(
    `${BASE}/${id}/documents`,
    { docType, contentType },
  );
}

export function deleteDocument(id: string, docType: DocumentType): Promise<null> {
  return http.delete<null>(`${BASE}/${id}/documents/${docType}`);
}

export async function uploadDocumentBytes(
  uploadUrl: string,
  file: File,
  headers?: Record<string, string>,
): Promise<void> {
  // The presigned URL is signed with SSE-KMS, so the encryption headers the
  // backend returns are part of the signature and MUST be replayed here — a PUT
  // with only Content-Type is rejected with a 403. Fall back to Content-Type
  // only if the backend didn't send headers (older API).
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: headers ?? { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new Error("Document upload failed");
}

export function getSensitive(id: string): Promise<SensitiveView> {
  return http.get<SensitiveView>(`${BASE}/${id}/sensitive`);
}

export function setSensitive(id: string, body: SetSensitiveBody): Promise<{ updated: string[] }> {
  return http.put<{ updated: string[] }>(`${BASE}/${id}/sensitive`, body);
}

export function getAudit(id: string): Promise<AuditRecord[]> {
  return http.get<AuditRecord[]>(`${BASE}/${id}/audit`);
}

/* ---- Users (for the name join — profiles store no name) ---- */

export async function fetchAllUsers(): Promise<User[]> {
  const all: User[] = [];
  let cursor: string | undefined;
  do {
    const q = new URLSearchParams({ limit: "100" });
    if (cursor) q.set("cursor", cursor);
    const page = await apiFetchPaginated<User>(`/users?${q}`);
    all.push(...page.data);
    cursor = page.pagination.nextCursor;
  } while (cursor && all.length < 5000);
  return all;
}

/* ---- Live location (dispatch map) ---- */

export interface LocationInput {
  lat: number;
  lng: number;
  accuracy?: number;
}

/** A technician reports their own position while online. */
export function postLocation(id: string, body: LocationInput): Promise<TechnicianLocation> {
  return http.post<TechnicianLocation>(`${BASE}/${id}/location`, body);
}

/** Go offline — drop the live position immediately. */
export function clearLocation(id: string): Promise<void> {
  return http.delete<void>(`${BASE}/${id}/location`);
}

/** Every online technician, for the dispatch map. */
export function listLocations(): Promise<TechnicianLocation[]> {
  return http.get<TechnicianLocation[]>(`${BASE}/locations`);
}
