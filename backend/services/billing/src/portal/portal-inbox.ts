import { BadRequestException } from '@nestjs/common';
import {
  PORTAL_INBOX_SHOW,
  portalInboxCompare,
  type Estimate,
  type Invoice,
  type PortalInboxKey,
  type PortalInboxShow,
} from '@bitcrm/types';

/** Entries per page: the portal shows ten, then "Load more". */
export const INBOX_PAGE_SIZE = 10;
/** The most one request may ask for (a reload re-reads what the client had scrolled to). */
export const INBOX_MAX_LIMIT = 100;

/** One line of the client's inbox, before anything expensive is worked out for it. */
export interface InboxRow extends PortalInboxKey {
  kind: 'invoice' | 'estimate' | 'proposal';
  id: string;
}

/** What a proposal needs to take its place in the inbox. */
export interface InboxProposal {
  id: string;
  sentAt: string;
  estimateIds: string[];
}

/** `?show=invoices,unpaid` → the filter; nothing (or nothing recognisable) means everything. */
export function parseInboxShow(raw: string | undefined): PortalInboxShow[] {
  const words = (raw ?? '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  const picked = PORTAL_INBOX_SHOW.filter((s) => words.includes(s));
  return picked.length ? picked : [...PORTAL_INBOX_SHOW];
}

/** `?limit=` within 1…100, ten by default. */
export function inboxLimit(raw: number | string | undefined): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? Math.min(n, INBOX_MAX_LIMIT) : INBOX_PAGE_SIZE;
}

/** Paid the way the portal's PAID chip reads it: marked paid, or nothing left to pay on an amount. */
export function isPaidInvoice(i: Pick<Invoice, 'status' | 'totals'>): boolean {
  if (i.status === 'paid') return true;
  const due = i.totals?.balanceDue;
  return typeof due === 'number' && due <= 0 && i.status !== 'no_amount';
}

/**
 * The client's whole inbox as cheap rows, in the shared order (newest first):
 * invoices, estimates that stand alone, and each proposal once — its
 * options live inside it, and a proposal with no option the client may see
 * is left out. `show` is Workiz's "Inbox Display": Invoices / Estimates pick
 * the kinds (a proposal is estimates), Paid / Unpaid narrow the invoices.
 */
export function inboxRows(
  invoices: Pick<Invoice, 'id' | 'invoiceDate' | 'status' | 'totals'>[],
  estimates: Pick<Estimate, 'id' | 'estimateDate'>[],
  proposals: InboxProposal[],
  show: readonly PortalInboxShow[],
): InboxRow[] {
  const rows: InboxRow[] = [];
  if (show.includes('invoices')) {
    for (const i of invoices) {
      if (!show.includes(isPaidInvoice(i) ? 'paid' : 'unpaid')) continue;
      rows.push({ kind: 'invoice', id: i.id, at: i.invoiceDate ?? '', ref: `invoice:${i.id}` });
    }
  }
  if (show.includes('estimates')) {
    const visible = new Set(estimates.map((e) => e.id));
    const inProposal = new Set<string>();
    for (const p of proposals) {
      if (!p.estimateIds.some((id) => visible.has(id))) continue;
      p.estimateIds.forEach((id) => inProposal.add(id));
      rows.push({ kind: 'proposal', id: p.id, at: p.sentAt ?? '', ref: `proposal:${p.id}` });
    }
    for (const e of estimates) {
      if (inProposal.has(e.id)) continue;
      rows.push({ kind: 'estimate', id: e.id, at: e.estimateDate ?? '', ref: `estimate:${e.id}` });
    }
  }
  return rows.sort(portalInboxCompare);
}

/**
 * One page after `after` (the last entry the client already has). Keyed on
 * the entry, not an offset, so a document sent meanwhile — it sorts to the
 * top — neither repeats nor hides a line on the next page.
 */
export function pageInboxRows(
  rows: InboxRow[],
  after: PortalInboxKey | undefined,
  limit: number,
): { page: InboxRow[]; nextCursor?: string } {
  const start = after ? rows.findIndex((r) => portalInboxCompare(after, r) < 0) : 0;
  if (start < 0) return { page: [] };
  const page = rows.slice(start, start + limit);
  const more = start + limit < rows.length;
  const last = page[page.length - 1];
  return more && last ? { page, nextCursor: encodeInboxCursor(last) } : { page };
}

export function encodeInboxCursor(key: PortalInboxKey): string {
  return Buffer.from(JSON.stringify({ at: key.at, ref: key.ref })).toString('base64url');
}

export function decodeInboxCursor(raw: string): PortalInboxKey {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<PortalInboxKey>;
    if (typeof parsed?.at === 'string' && typeof parsed.ref === 'string') return { at: parsed.at, ref: parsed.ref };
  } catch {
    // fall through
  }
  throw new BadRequestException('Invalid cursor');
}
