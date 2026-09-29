import type { DealEquipment, DealEquipmentInput } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/** An edit: any field of the form; `null` clears an optional one. */
export type EquipmentPatch = { [K in keyof DealEquipmentInput]?: DealEquipmentInput[K] | null };

export function listEquipment(dealId: string): Promise<DealEquipment[]> {
  return http.get<DealEquipment[]>(`/deals/${dealId}/equipment`);
}

export function createEquipment(dealId: string, body: DealEquipmentInput): Promise<DealEquipment> {
  return http.post<DealEquipment>(`/deals/${dealId}/equipment`, body);
}

export function updateEquipment(dealId: string, equipmentId: string, body: EquipmentPatch): Promise<DealEquipment> {
  return http.patch<DealEquipment>(`/deals/${dealId}/equipment/${equipmentId}`, body);
}

export function deleteEquipment(dealId: string, equipmentId: string): Promise<null> {
  return http.delete<null>(`/deals/${dealId}/equipment/${equipmentId}`);
}
