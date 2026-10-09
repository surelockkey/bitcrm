/**
 * Settings → Numbering (Workiz `/root/numbering`): the next number a CLIENT
 * document gets. A job's documents keep the job's number (the invoice) or
 * `<job number>-<n>` (an estimate), as Workiz shows them; a client's invoice
 * or estimate — no job to borrow from — takes the next number of its own
 * counter here, which the office sets once at cut-over to carry Workiz's
 * sequences on (its live page showed invoice 85 700 / estimate 1 144 on
 * 2026-10-09; the dump of 2026-09-29 ended at 85 425 / 1 140).
 *
 * The numbers answered are the NEXT ones: what the next client invoice and
 * the next client estimate will be called. Setting one must exceed the last
 * number handed out — a number is never reused.
 */
export interface NumberingSettings {
  nextInvoiceNumber: number;
  nextEstimateNumber: number;
  updatedBy?: string;
  updatedAt?: string;
}

/** Nine digits: room for a lifetime of invoices, still a plain integer everywhere. */
export const DOCUMENT_NUMBER_MAX = 999_999_999;
