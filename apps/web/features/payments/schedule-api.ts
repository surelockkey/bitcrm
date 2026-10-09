import type { PaymentScheduleView, SavePaymentScheduleBody } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/**
 * Workiz's Payment schedule on a job (billing `payment-schedule.controller.ts`):
 * read with `payments.view`, set / removed with `payments.collect`, one
 * payment's invoice PDF with `invoices.view`.
 */
const base = (dealId: string) => `/billing/deals/${dealId}/payment-schedule`;

/** `null` when the job has no schedule. */
export const getPaymentSchedule = (dealId: string): Promise<PaymentScheduleView | null> =>
  http.get<PaymentScheduleView | null>(base(dealId));

/** The whole schedule, replaced. */
export const savePaymentSchedule = (dealId: string, body: SavePaymentScheduleBody): Promise<PaymentScheduleView> =>
  http.put<PaymentScheduleView>(base(dealId), body);

export const deletePaymentSchedule = (dealId: string): Promise<unknown> => http.delete<unknown>(base(dealId));

/** Workiz's View on one payment: the job's invoice with that payment as its Balance due. */
export const getScheduledPaymentPdfUrl = (dealId: string, lineId: string): Promise<{ url: string }> =>
  http.get<{ url: string }>(`${base(dealId)}/${lineId}/pdf`);
