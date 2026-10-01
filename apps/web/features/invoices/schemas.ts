import { z } from "zod";
import { PaymentTerms, type DocumentDiscount, type DocumentVisibility } from "@bitcrm/types";
import { isYmd } from "@/features/billing/dates";

const ymd = z.string().refine((v) => isYmd(v), "Pick a valid date");

/** The editable invoice header (PATCH /billing/invoices/:id). */
export const invoiceEditSchema = z
  .object({
    invoiceDate: ymd,
    paymentTerms: z.nativeEnum(PaymentTerms),
    dueDate: ymd,
    notes: z.string().trim().max(5000, "Notes are too long"),
  })
  .refine((v) => v.dueDate >= v.invoiceDate, {
    message: "Due date can't be before the invoice date",
    path: ["dueDate"],
  });

export type InvoiceEditValues = z.infer<typeof invoiceEditSchema>;

export interface InvoicePatch {
  invoiceDate?: string;
  paymentTerms?: PaymentTerms;
  dueDate?: string;
  notes?: string;
  templateId?: string | null;
  /** A CLIENT invoice's own tax rate / discount (a job invoice's are the job's). */
  taxRateId?: string | null;
  discount?: DocumentDiscount | null;
  /** Workiz Send panel "Request signature": the portal asks the client to sign before paying. */
  requestSignature?: boolean;
  /** Workiz Send panel "Advanced": what the client sees; `null` = the template's own. */
  display?: Partial<DocumentVisibility> | null;
}
