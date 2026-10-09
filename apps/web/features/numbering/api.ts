import type { NumberingSettings } from "@bitcrm/types";
import { http } from "@/lib/api/http";

const BASE = "/billing/numbering";

/** A counter left out is left alone. */
export interface NumberingBody {
  nextInvoiceNumber?: number;
  nextEstimateNumber?: number;
}

/** Settings → Numbering: what the next client invoice and client estimate will be numbered. */
export const getNumbering = (): Promise<NumberingSettings> => http.get<NumberingSettings>(BASE);

export const updateNumbering = (body: NumberingBody): Promise<NumberingSettings> =>
  http.put<NumberingSettings>(BASE, body);
