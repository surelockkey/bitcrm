import type { WorkOrder, WorkOrderStatus } from "@bitcrm/types";
import { http } from "@/lib/api/http";
import type { WorkOrderFormValues } from "./schemas";

export function listWorkOrders(params: { companyId?: string; status?: WorkOrderStatus } = {}): Promise<WorkOrder[]> {
  const q = new URLSearchParams();
  if (params.companyId) q.set("companyId", params.companyId);
  if (params.status) q.set("status", params.status);
  const s = q.toString();
  return http.get<WorkOrder[]>(`/crm/work-orders${s ? `?${s}` : ""}`);
}

export const getWorkOrder = (id: string): Promise<WorkOrder> =>
  http.get<WorkOrder>(`/crm/work-orders/${id}`);

export const createWorkOrder = (body: WorkOrderFormValues): Promise<WorkOrder> =>
  http.post<WorkOrder>("/crm/work-orders", body);

export const updateWorkOrder = (id: string, body: Partial<WorkOrder>): Promise<WorkOrder> =>
  http.put<WorkOrder>(`/crm/work-orders/${id}`, body);

export const deleteWorkOrder = (id: string): Promise<{ archived: boolean }> =>
  http.delete<{ archived: boolean }>(`/crm/work-orders/${id}`);

export const getWorkOrderDocumentUploadUrl = (
  id: string,
  contentType: string,
): Promise<{ uploadUrl: string; s3Key: string; headers?: Record<string, string> }> =>
  http.post<{ uploadUrl: string; s3Key: string; headers?: Record<string, string> }>(
    `/crm/work-orders/${id}/document`,
    { contentType },
  );

export async function uploadWorkOrderDocumentBytes(
  uploadUrl: string,
  file: File,
  headers?: Record<string, string>,
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: headers ?? { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new Error("Document upload failed");
}
