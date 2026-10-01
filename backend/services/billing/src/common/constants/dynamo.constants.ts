/**
 * One table for the billing domain — `bitcrm-<env>-billing` in AWS
 * (Terraform `infra/dev/data_plane.tf`), `BitCRM_Billing` locally. Tests
 * point this at `BitCRM_Billing_Test`.
 */
export const BILLING_TABLE = process.env.BILLING_TABLE || 'BitCRM_Billing';

// ---------------------------------------------------------------------------
// Indexes. Names and key attributes MUST match Terraform.
//
//   GSI1 ListIndex      GSI1PK = INVOICES | ESTIMATES | TEMPLATES | BUSINESS_PROFILES
//                       GSI1SK = <createdAt>#<id>          newest-first lists
//   GSI2 ContactIndex   GSI2PK = CONTACT#<contactId>
//                       GSI2SK = INVOICE#<createdAt>#<id> | ESTIMATE#<createdAt>#<id>
//   GSI3 DealIndex      GSI3PK = DEAL#<dealId>              (sparse: a JOB's estimates only —
//                       GSI3SK = ESTIMATE#<createdAt>#<id>   a client estimate has no job and no row here)
//   GSI4 UnpaidIndex    GSI4PK = UNPAID                     (sparse: open invoices only)
//                       GSI4SK = <invoiceId>
//
// UnpaidIndex holds exactly the invoices that still owe money (status `due`
// or `overdue`, more than a cent owed — Workiz's rule) — ~550 of ~78 000. Aging invoices, the Invoices report's
// cards and "Days due", and the overdue sweep read that one small partition
// instead of the whole list. The keys follow `status` on every write
// (`unpaidIndexKeys`), so no caller maintains them; rows written before the
// index existed get them from `backfill:unpaid-index`, which then stamps
// `UNPAIDINDEX / STATE` — until that row exists the readers fall back to the
// full list (slow, still right).
//
// The payment ledger reuses the same two list indexes: GSI1 `PAYMENTS` for
// the report page and GSI2 `CONTACT#<id>` / `PAYMENT#…` for a client's
// payment history, so no fourth index is needed.
//
// Tradeoff: the invoice/estimate lists use one constant partition per kind
// and filter `status` / `sentAt` with a FilterExpression. That is the
// CALL#ALL pattern CLAUDE.md warns about, accepted here because the volume
// is one invoice per job (tens of thousands, not millions) and status is a
// derived value that changes without a write from the user (overdue). If the
// lists grow past that, split the partition by year (INVOICES#<YYYY>) like
// the messaging inbox.
// ---------------------------------------------------------------------------
export const BILLING_GSI1_NAME = 'ListIndex';
export const BILLING_GSI2_NAME = 'ContactIndex';
export const BILLING_GSI3_NAME = 'DealIndex';
export const BILLING_GSI4_NAME = 'UnpaidIndex';

export const BILLING_GSIS: ReadonlyArray<{ n: 1 | 2 | 3 | 4; name: string }> = [
  { n: 1, name: BILLING_GSI1_NAME },
  { n: 2, name: BILLING_GSI2_NAME },
  { n: 3, name: BILLING_GSI3_NAME },
  { n: 4, name: BILLING_GSI4_NAME },
];

export const METADATA_SK = 'METADATA';

// ---- invoices --------------------------------------------------------------
/** `INVOICE#<dealId>` / METADATA — one per job, id === dealId. */
export const invoicePk = (dealId: string) => `INVOICE#${dealId}`;
export const INVOICES_GSI1PK = 'INVOICES';

/** UnpaidIndex partition: every invoice that still owes money, and nothing else. */
export const UNPAID_GSI4PK = 'UNPAID';
/** The invoice statuses that put an invoice on UnpaidIndex. */
export const UNPAID_STATUSES: ReadonlySet<string> = new Set(['due', 'overdue']);
/** Workiz counts a balance of a cent or less as paid (`INVOICE_PAID_TOLERANCE` in @bitcrm/types). */
export const UNPAID_BALANCE_TOLERANCE = 0.01;
/**
 * The UnpaidIndex keys an invoice carries, or `null` = none (the row must not
 * be on the index): open status AND more than a cent owed, as Workiz counts
 * unpaid. `balanceDue` unknown (a write that names the status but not the
 * totals) answers by status alone — callers that know the balance pass it.
 * The sort key is the id: every reader takes the whole ~600-row partition and
 * orders it itself.
 */
export function unpaidIndexKeys(
  id: string,
  status: string | undefined,
  balanceDue?: number,
): { GSI4PK: string; GSI4SK: string } | null {
  if (!status || !UNPAID_STATUSES.has(status)) return null;
  if (typeof balanceDue === 'number' && !(balanceDue > UNPAID_BALANCE_TOLERANCE)) return null;
  return { GSI4PK: UNPAID_GSI4PK, GSI4SK: id };
}
/** `UNPAIDINDEX` / `STATE` — written by `backfill:unpaid-index` once every row carries its keys. */
export const UNPAID_INDEX_STATE_PK = 'UNPAIDINDEX';
export const UNPAID_INDEX_STATE_SK = 'STATE';

// ---- estimates -------------------------------------------------------------
/** `ESTIMATE#<id>` / METADATA, and `ESTIMATE#<id>` / `ITEM#<lineId>` rows. */
export const estimatePk = (id: string) => `ESTIMATE#${id}`;
export const ITEM_SK_PREFIX = 'ITEM#';
export const estimateItemSk = (lineId: string) => `${ITEM_SK_PREFIX}${lineId}`;
export const ESTIMATES_GSI1PK = 'ESTIMATES';

/** `DEAL#<dealId>` / COUNTERS — `estimateSeq` is ADDed atomically per new estimate. */
export const dealCountersPk = (dealId: string) => `DEAL#${dealId}`;
export const COUNTERS_SK = 'COUNTERS';
/**
 * `COUNTERS#ACCOUNT` / COUNTERS — `documentSeq`, ADDed per new CLIENT document
 * (an estimate or invoice with no job; see `common/document-number.ts`). One
 * counter for both kinds, so a client estimate and a client invoice never
 * share a number.
 */
export const ACCOUNT_COUNTERS_PK = 'COUNTERS#ACCOUNT';

// ---- templates / settings / assets / portal ----------------------------------
/** `TEMPLATE#<id>` / METADATA. */
export const templatePk = (id: string) => `TEMPLATE#${id}`;
export const TEMPLATES_GSI1PK = 'TEMPLATES';
export const DEFAULT_INVOICE_TEMPLATE_ID = 'tpl-default-invoice';
export const DEFAULT_ESTIMATE_TEMPLATE_ID = 'tpl-default-estimate';

/**
 * LEGACY `SETTINGS` / BUSINESS_PROFILE singleton — read once and migrated
 * into `BUSINESS_PROFILE#bp-default` (then deleted) by BusinessProfileService.
 */
export const SETTINGS_PK = 'SETTINGS';
export const BUSINESS_PROFILE_SK = 'BUSINESS_PROFILE';

/** `BUSINESS_PROFILE#<id>` / METADATA — one per company; listed via GSI1 `BUSINESS_PROFILES`. */
export const businessProfilePk = (id: string) => `BUSINESS_PROFILE#${id}`;
export const BUSINESS_PROFILES_GSI1PK = 'BUSINESS_PROFILES';

/** `ASSET#<id>` / METADATA; the bytes live at S3 `billing/assets/<id>`. */
export const assetPk = (id: string) => `ASSET#${id}`;
export const assetS3Key = (id: string) => `billing/assets/${id}`;

/** Rendered PDFs, content-addressed: `billing/pdfs/<docId>/<hash>.pdf`. */
export const pdfS3Key = (docId: string, hash: string) => `billing/pdfs/${docId}/${hash}.pdf`;

/** `PORTAL#<sha256(token)>` / METADATA → contactId. The raw token is never stored. */
export const portalTokenPk = (tokenHash: string) => `PORTAL#${tokenHash}`;
/** `CONTACT#<id>` / PORTAL_LINK — the link's metadata (+ current token hash). */
export const contactPk = (contactId: string) => `CONTACT#${contactId}`;
export const PORTAL_LINK_SK = 'PORTAL_LINK';

// ---- payments ----------------------------------------------------------------
/**
 * The payment ledger. Every payment is written twice, in one transaction:
 *
 *   PAYMENT#<paymentId>  / METADATA                     the canonical row
 *                          GSI1 PAYMENTS / <createdAt>#<id>
 *                          GSI2 CONTACT#<contactId> / PAYMENT#<createdAt>#<id>
 *   INVOICE#<dealId>     / PAYMENT#<createdAt>#<id>     the same payment, adjacent
 *                                                       to its invoice, so one
 *                                                       Query reads a job's ledger
 *   PAYMENT#<paymentId>  / REFUND#<createdAt>#<refundId>
 *   STRIPE#<objectId>    / POINTER    → {paymentId}; written for the session,
 *                                       the intent and the charge, so a webhook
 *                                       finds its payment in ONE read
 *   WEBHOOK#<eventId>    / METADATA   dedupe, `expiresAt` TTL (30 days)
 *   SETTINGS            / PAYMENTS    the PaymentSettings singleton
 */
export const paymentPk = (paymentId: string) => `PAYMENT#${paymentId}`;
export const PAYMENT_SK_PREFIX = 'PAYMENT#';
/** SK of a payment under its invoice partition — time-ordered within the job. */
export const invoicePaymentSk = (createdAt: string, paymentId: string) =>
  `${PAYMENT_SK_PREFIX}${createdAt}#${paymentId}`;
export const PAYMENTS_GSI1PK = 'PAYMENTS';

export const REFUND_SK_PREFIX = 'REFUND#';
export const refundSk = (createdAt: string, refundId: string) => `${REFUND_SK_PREFIX}${createdAt}#${refundId}`;

/** `STRIPE#<sessionId|paymentIntentId|chargeId>` / POINTER → `{ paymentId }`. */
export const stripePointerPk = (stripeObjectId: string) => `STRIPE#${stripeObjectId}`;
export const STRIPE_POINTER_SK = 'POINTER';

/** `WEBHOOK#<stripeEventId>` / METADATA — the dedupe row; expires via `expiresAt`. */
export const webhookEventPk = (eventId: string) => `WEBHOOK#${eventId}`;
/** Stripe replays for at most 3 days; 30 covers a replay from the dashboard too. */
export const WEBHOOK_EVENT_TTL_DAYS = 30;

/** `SETTINGS` / PAYMENTS — the account-wide PaymentSettings singleton. */
export const PAYMENT_SETTINGS_SK = 'PAYMENTS';

// ---- payments report (a derived projection of the ledger) ----------------------
/**
 * The Payments report (Workiz Reports → Payments) reads its own rows, never
 * the ledger's list index — so it is keyed by the PAYMENT date (not
 * `createdAt`), lists refunds as lines of their own, and totals any range
 * from pre-summed buckets instead of reading every payment in it:
 *
 *   PAYMENT#<paymentId> / REPORT          which lines the payment has, and what each
 *                                          one added to its bucket — the delta base
 *   PAYLINE#<YYYY-MM>   / <at>#<lineId>   one line (payment, refund, reversal); the
 *                                          month and `at` are the business-day clock's
 *   PAYAGG#<YYYY>       / D#<day>#<type>#<tech|->#<area|->    day bucket  } ADDed counters:
 *   PAYAGG#<YYYY>       / M#<YYYY-MM>#<type>#<tech|->#<area|-> month bucket} n, amountCents,
 *                                                                           tipsCents, feesCents
 *   PAYREPORT           / INDEX           {firstMonth, lastMonth} — "All time"'s bounds
 *
 * Rebuilt from the ledger by `npm run rebuild:payment-report` (reconciles:
 * rows the ledger no longer explains are removed). No GSI keys on any of them.
 */
export const PAYMENT_REPORT_POINTER_SK = 'REPORT';
export const paylinePk = (month: string) => `PAYLINE#${month}`;
export const paylineSk = (at: string, lineId: string) => `${at}#${lineId}`;
export const payaggPk = (year: string) => `PAYAGG#${year}`;
export const payaggDaySk = (day: string, bucket: string) => `D#${day}#${bucket}`;
export const payaggMonthSk = (month: string, bucket: string) => `M#${month}#${bucket}`;
export const PAYREPORT_INDEX_PK = 'PAYREPORT';
export const PAYREPORT_INDEX_SK = 'INDEX';

// ---- index keys --------------------------------------------------------------
export const listSk = (createdAt: string, id: string) => `${createdAt}#${id}`;
export const contactGsi2Pk = (contactId: string) => `CONTACT#${contactId}`;
export const contactGsi2Sk = (kind: 'INVOICE' | 'ESTIMATE' | 'PAYMENT', createdAt: string, id: string) =>
  `${kind}#${createdAt}#${id}`;
export const dealGsi3Pk = (dealId: string) => `DEAL#${dealId}`;
export const dealGsi3Sk = (createdAt: string, id: string) => `ESTIMATE#${createdAt}#${id}`;

/** Attributes that are storage plumbing, never part of an entity. */
export const KEY_ATTRIBUTES = [
  'PK',
  'SK',
  'GSI1PK',
  'GSI1SK',
  'GSI2PK',
  'GSI2SK',
  'GSI3PK',
  'GSI3SK',
  'GSI4PK',
  'GSI4SK',
  'entityType',
  // TTL plumbing (webhook dedupe rows) — never part of an entity.
  'expiresAt',
] as const;

/** Removes key attributes from a raw item. */
export function stripKeys<T>(item: Record<string, unknown> | undefined | null): T | null {
  if (!item) return null;
  const copy: Record<string, unknown> = { ...item };
  for (const k of KEY_ATTRIBUTES) delete copy[k];
  return copy as T;
}
