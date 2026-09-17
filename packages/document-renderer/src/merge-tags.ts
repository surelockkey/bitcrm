import type { DocumentRenderContext, DocumentTemplateKind } from '@bitcrm/types';
import { formatMoney, formatPercent } from './money';

export type MergeTagGroupId = 'business' | 'client' | 'job' | 'document' | 'totals' | 'other';

export interface MergeTagDef {
  /** Dotted path used in `{{path}}` and in `mergeTag` nodes. */
  path: string;
  label: string;
  group: MergeTagGroupId;
  /** Template kinds the tag is meaningful for (editor filters the picker by this). */
  kinds: DocumentTemplateKind[];
  /** Realistic example value (shown in the tag picker). */
  sample: string;
}

export const MERGE_TAG_GROUPS: { id: MergeTagGroupId; label: string }[] = [
  { id: 'business', label: 'Business' },
  { id: 'client', label: 'Client' },
  { id: 'job', label: 'Job' },
  { id: 'document', label: 'Document' },
  { id: 'totals', label: 'Totals' },
  { id: 'other', label: 'Other' },
];

type Resolver = (ctx: DocumentRenderContext) => unknown;

interface TagSpec extends MergeTagDef {
  resolve: Resolver;
  format?: 'money' | 'percent';
}

const ALL: DocumentTemplateKind[] = ['invoice', 'estimate', 'custom'];
const BILLING: DocumentTemplateKind[] = ['invoice', 'estimate'];
const INVOICE: DocumentTemplateKind[] = ['invoice'];
const ESTIMATE: DocumentTemplateKind[] = ['estimate'];

const SPECS: TagSpec[] = [
  // Business
  { path: 'business.name', label: 'Business name', group: 'business', kinds: ALL, sample: 'SureLock Key Services', resolve: (c) => c.business?.name },
  { path: 'business.legalName', label: 'Legal name', group: 'business', kinds: ALL, sample: 'SureLock Key Services LLC', resolve: (c) => c.business?.legalName },
  { path: 'business.phone', label: 'Business phone', group: 'business', kinds: ALL, sample: '(860) 555-0142', resolve: (c) => c.business?.phone },
  { path: 'business.email', label: 'Business email', group: 'business', kinds: ALL, sample: 'office@surelockkey.com', resolve: (c) => c.business?.email },
  { path: 'business.website', label: 'Website', group: 'business', kinds: ALL, sample: 'www.surelockkey.com', resolve: (c) => c.business?.website },
  { path: 'business.licenseNumber', label: 'License number', group: 'business', kinds: ALL, sample: 'LCK.0001234', resolve: (c) => c.business?.licenseNumber },
  { path: 'business.address', label: 'Business address', group: 'business', kinds: ALL, sample: '120 Main St, Hartford, CT 06103', resolve: (c) => c.business?.address },
  // Client
  { path: 'client.firstName', label: 'First name', group: 'client', kinds: ALL, sample: 'Emily', resolve: (c) => c.client?.firstName },
  { path: 'client.lastName', label: 'Last name', group: 'client', kinds: ALL, sample: 'Carter', resolve: (c) => c.client?.lastName },
  { path: 'client.fullName', label: 'Full name', group: 'client', kinds: ALL, sample: 'Emily Carter', resolve: (c) => c.client?.fullName },
  { path: 'client.companyName', label: 'Company', group: 'client', kinds: ALL, sample: 'Carter Dental Group', resolve: (c) => c.client?.companyName },
  { path: 'client.email', label: 'Client email', group: 'client', kinds: ALL, sample: 'emily.carter@example.com', resolve: (c) => c.client?.email },
  { path: 'client.phone', label: 'Client phone', group: 'client', kinds: ALL, sample: '(860) 555-0199', resolve: (c) => c.client?.phone },
  { path: 'client.address', label: 'Client address', group: 'client', kinds: ALL, sample: '45 Oak Ave, West Hartford, CT 06107', resolve: (c) => c.client?.address },
  { path: 'client.billingAddress', label: 'Billing address', group: 'client', kinds: ALL, sample: 'PO Box 311, West Hartford, CT 06127', resolve: (c) => c.client?.billingAddress },
  // Job
  { path: 'job.number', label: 'Job number', group: 'job', kinds: ALL, sample: '1042', resolve: (c) => c.job?.number },
  { path: 'job.address', label: 'Service address', group: 'job', kinds: ALL, sample: '45 Oak Ave, West Hartford, CT 06107', resolve: (c) => c.job?.address },
  { path: 'job.jobType', label: 'Job type', group: 'job', kinds: ALL, sample: 'Rekey & lock upgrade', resolve: (c) => c.job?.jobType },
  { path: 'job.serviceArea', label: 'Service area', group: 'job', kinds: ALL, sample: 'Hartford County', resolve: (c) => c.job?.serviceArea },
  { path: 'job.scheduledDate', label: 'Scheduled date', group: 'job', kinds: ALL, sample: 'Sep 12, 2026 10:00 AM', resolve: (c) => c.job?.scheduledDate },
  { path: 'job.technicians', label: 'Technicians', group: 'job', kinds: ALL, sample: 'Mike Rivera', resolve: (c) => c.job?.technicians },
  { path: 'job.poNumber', label: 'PO number', group: 'job', kinds: ALL, sample: 'PO-7781', resolve: (c) => c.job?.poNumber },
  // Document
  { path: 'document.number', label: 'Document number', group: 'document', kinds: ALL, sample: '1042', resolve: (c) => c.document?.number },
  { path: 'document.date', label: 'Document date', group: 'document', kinds: ALL, sample: 'Sep 12, 2026', resolve: (c) => c.document?.date },
  { path: 'document.dueDate', label: 'Due date', group: 'document', kinds: INVOICE, sample: 'Sep 26, 2026', resolve: (c) => c.document?.dueDate },
  { path: 'document.paymentTerms', label: 'Payment terms', group: 'document', kinds: INVOICE, sample: 'Net 14', resolve: (c) => c.document?.paymentTerms },
  { path: 'document.status', label: 'Status', group: 'document', kinds: BILLING, sample: 'Due', resolve: (c) => c.document?.status },
  { path: 'document.name', label: 'Estimate name', group: 'document', kinds: ESTIMATE, sample: 'Option A – High-security upgrade', resolve: (c) => c.document?.name },
  { path: 'document.notes', label: 'Notes', group: 'document', kinds: ALL, sample: 'Gate code 4471. Please call on arrival.', resolve: (c) => c.document?.notes },
  // Totals
  { path: 'totals.subtotal', label: 'Subtotal', group: 'totals', kinds: BILLING, sample: '$470.00', format: 'money', resolve: (c) => c.totals?.subtotal },
  { path: 'totals.discount', label: 'Discount', group: 'totals', kinds: BILLING, sample: '$25.00', format: 'money', resolve: (c) => c.totals?.discount },
  { path: 'totals.taxRateName', label: 'Tax rate name', group: 'totals', kinds: BILLING, sample: 'CT Sales Tax', resolve: (c) => c.totals?.taxRateName },
  { path: 'totals.taxRatePercent', label: 'Tax rate %', group: 'totals', kinds: BILLING, sample: '6.35%', format: 'percent', resolve: (c) => c.totals?.taxRatePercent },
  { path: 'totals.tax', label: 'Tax amount', group: 'totals', kinds: BILLING, sample: '$20.74', format: 'money', resolve: (c) => c.totals?.tax },
  { path: 'totals.total', label: 'Total', group: 'totals', kinds: BILLING, sample: '$465.74', format: 'money', resolve: (c) => c.totals?.total },
  { path: 'totals.amountPaid', label: 'Amount paid', group: 'totals', kinds: INVOICE, sample: '$100.00', format: 'money', resolve: (c) => c.totals?.amountPaid },
  { path: 'totals.balanceDue', label: 'Balance due', group: 'totals', kinds: INVOICE, sample: '$365.74', format: 'money', resolve: (c) => c.totals?.balanceDue },
  // Other
  { path: 'today', label: "Today's date", group: 'other', kinds: ALL, sample: 'Sep 16, 2026', resolve: (c) => c.today },
];

const BY_PATH = new Map<string, TagSpec>(SPECS.map((s) => [s.path, s]));

export const MERGE_TAGS: MergeTagDef[] = SPECS.map(({ path, label, group, kinds, sample }) => ({
  path,
  label,
  group,
  kinds: [...kinds],
  sample,
}));

const CUSTOM_FIELD_PREFIX = 'job.customFields.';
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return '';
}

/**
 * Resolves a merge-tag path to display text (unescaped). Only whitelisted
 * paths (MERGE_TAGS) and `job.customFields.<key>` resolve; everything else —
 * and every missing value — yields `''`. `invoice.*` / `estimate.*` are
 * accepted as aliases of `document.*`.
 */
export function resolveMergeTag(path: string, ctx: DocumentRenderContext): string {
  if (typeof path !== 'string' || !ctx) return '';
  let p = path.trim();
  if (!p) return '';
  if (p.startsWith('invoice.') || p.startsWith('estimate.')) p = `document.${p.slice(p.indexOf('.') + 1)}`;

  if (p.startsWith(CUSTOM_FIELD_PREFIX)) {
    const key = p.slice(CUSTOM_FIELD_PREFIX.length);
    const fields = ctx.job?.customFields;
    if (!key || FORBIDDEN_KEYS.has(key) || !fields || typeof fields !== 'object') return '';
    if (!Object.prototype.hasOwnProperty.call(fields, key)) return '';
    return stringify(fields[key]);
  }

  const spec = BY_PATH.get(p);
  if (!spec) return '';
  let value: unknown;
  try {
    value = spec.resolve(ctx);
  } catch {
    return '';
  }
  if (value === undefined || value === null || value === '') return '';
  if (spec.format === 'money') return typeof value === 'number' ? formatMoney(value, ctx.currency) : '';
  if (spec.format === 'percent') return typeof value === 'number' ? formatPercent(value) : '';
  return stringify(value);
}

const TAG_RE = /\{\{\s*([A-Za-z0-9_.-]{1,200})\s*\}\}/g;

/** Replaces every `{{path}}` in `text` with its resolved (unescaped) value. */
export function interpolate(text: string, ctx: DocumentRenderContext): string {
  if (typeof text !== 'string' || !text.includes('{{')) return typeof text === 'string' ? text : '';
  return text.replace(TAG_RE, (_m, path: string) => resolveMergeTag(path, ctx));
}
