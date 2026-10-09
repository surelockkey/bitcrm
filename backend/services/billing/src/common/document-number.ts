/**
 * LEGACY numbering for a document that belongs to a CLIENT and no job —
 * Workiz's "stub" estimate / invoice, made from the client card's Create new
 * menu.
 *
 * A job's documents are numbered from the job (`<dealNumber>-<n>` for an
 * estimate, the job's number for its invoice). A client's documents have no
 * job to borrow a number from; they used to take one from a single
 * account-wide counter (`COUNTERS#ACCOUNT` / `documentSeq`, shared by
 * estimates and invoices), offset so the first numbers already looked like
 * Workiz's four-digit ones (1141), not 1, 2, 3.
 *
 * Since Settings → Numbering (`numbering/`), each kind has a settable counter
 * of its own (`lastInvoiceNumber` / `lastEstimateNumber` on the same row)
 * that starts from `STANDALONE_NUMBER_BASE + documentSeq`, so the legacy
 * numbers are never handed out again. This formula now serves only a service
 * built without `NumberingService` (unit tests).
 */
export const STANDALONE_NUMBER_BASE = 1000;

export function standaloneDocumentNumber(seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error(`Document counter must be a positive integer, got ${String(seq)}`);
  }
  return String(STANDALONE_NUMBER_BASE + seq);
}
