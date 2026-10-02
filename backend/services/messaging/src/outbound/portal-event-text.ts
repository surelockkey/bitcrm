import type { PortalEventRequest } from '@bitcrm/types';

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The line Workiz writes into a client's thread when they act on the portal —
 * "Viewed estimate #…", "Josh Wilenski signed Invoice #…", "… submitted
 * payment for invoice #…" (from the Workiz export) — with the document number
 * on a decline and the amount on a payment, which Workiz leaves out.
 */
export function portalEventText(
  req: Pick<PortalEventRequest, 'event' | 'document' | 'amount'>,
  name: string | undefined,
): string {
  const who = name?.trim() || 'The client';
  const { kind, number } = req.document;
  const amount = typeof req.amount === 'number' ? ` (${money(req.amount)})` : '';
  switch (req.event) {
    case 'viewed':
      return `Viewed ${kind} #${number}`;
    case 'signed':
      return kind === 'invoice' ? `${who} signed Invoice #${number}` : `${who} signed estimate #${number}`;
    case 'declined':
      return `${who} declined ${kind} #${number}`;
    case 'payment':
      return kind === 'estimate'
        ? `${who} submitted a deposit for estimate #${number}${amount}`
        : `${who} submitted payment for invoice #${number}${amount}`;
  }
}
