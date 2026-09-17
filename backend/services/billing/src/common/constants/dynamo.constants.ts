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
//   GSI3 DealIndex      GSI3PK = DEAL#<dealId>              (sparse: estimates only)
//                       GSI3SK = ESTIMATE#<createdAt>#<id>
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

export const BILLING_GSIS: ReadonlyArray<{ n: 1 | 2 | 3; name: string }> = [
  { n: 1, name: BILLING_GSI1_NAME },
  { n: 2, name: BILLING_GSI2_NAME },
  { n: 3, name: BILLING_GSI3_NAME },
];

export const METADATA_SK = 'METADATA';

// ---- invoices --------------------------------------------------------------
/** `INVOICE#<dealId>` / METADATA — one per job, id === dealId. */
export const invoicePk = (dealId: string) => `INVOICE#${dealId}`;
export const INVOICES_GSI1PK = 'INVOICES';

// ---- estimates -------------------------------------------------------------
/** `ESTIMATE#<id>` / METADATA, and `ESTIMATE#<id>` / `ITEM#<lineId>` rows. */
export const estimatePk = (id: string) => `ESTIMATE#${id}`;
export const ITEM_SK_PREFIX = 'ITEM#';
export const estimateItemSk = (lineId: string) => `${ITEM_SK_PREFIX}${lineId}`;
export const ESTIMATES_GSI1PK = 'ESTIMATES';

/** `DEAL#<dealId>` / COUNTERS — `estimateSeq` is ADDed atomically per new estimate. */
export const dealCountersPk = (dealId: string) => `DEAL#${dealId}`;
export const COUNTERS_SK = 'COUNTERS';

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

// ---- index keys --------------------------------------------------------------
export const listSk = (createdAt: string, id: string) => `${createdAt}#${id}`;
export const contactGsi2Pk = (contactId: string) => `CONTACT#${contactId}`;
export const contactGsi2Sk = (kind: 'INVOICE' | 'ESTIMATE', createdAt: string, id: string) =>
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
  'entityType',
] as const;

/** Removes key attributes from a raw item. */
export function stripKeys<T>(item: Record<string, unknown> | undefined | null): T | null {
  if (!item) return null;
  const copy: Record<string, unknown> = { ...item };
  for (const k of KEY_ATTRIBUTES) delete copy[k];
  return copy as T;
}
