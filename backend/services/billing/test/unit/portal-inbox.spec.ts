import { BadRequestException } from '@nestjs/common';
import type { Estimate, Invoice } from '@bitcrm/types';
import { decodeInboxCursor, encodeInboxCursor, inboxRows, pageInboxRows, parseInboxShow } from 'src/portal/portal-inbox';

const inv = (id: string, invoiceDate: string, over: Partial<Invoice> = {}) =>
  ({ id, invoiceDate, status: 'due', totals: { total: 100, balanceDue: 100 }, sentAt: 'x', ...over }) as Invoice;
const est = (id: string, estimateDate: string, over: Partial<Estimate> = {}) =>
  ({ id, estimateDate, status: 'pending', sentAt: 'x', ...over }) as Estimate;
const ALL = parseInboxShow(undefined);

describe('portal inbox paging', () => {
  it('reads the Inbox Display filter: nothing or garbage means everything, unknown words are dropped', () => {
    expect(ALL).toEqual(['invoices', 'estimates', 'paid', 'unpaid']);
    expect(parseInboxShow('')).toEqual(ALL);
    expect(parseInboxShow('Invoices, unpaid ,bogus')).toEqual(['invoices', 'unpaid']);
    expect(parseInboxShow('bogus')).toEqual(ALL);
  });

  it('lists invoices, standalone estimates and proposals newest first; a proposal is one entry, its options are not', () => {
    const rows = inboxRows(
      [inv('i1', '2026-09-10'), inv('i2', '2026-09-20')],
      [est('e1', '2026-09-15'), est('e2', '2026-09-18', { proposalId: 'p1' }), est('e3', '2026-09-18', { proposalId: 'p1' })],
      [{ id: 'p1', sentAt: '2026-09-19T10:00:00.000Z', estimateIds: ['e2', 'e3'] }],
      ALL,
    );
    expect(rows.map((r) => r.ref)).toEqual(['invoice:i2', 'proposal:p1', 'estimate:e1', 'invoice:i1']);
  });

  it('drops a proposal none of whose options the client may see', () => {
    const rows = inboxRows([], [], [{ id: 'p1', sentAt: '2026-09-19T10:00:00.000Z', estimateIds: ['gone'] }], ALL);
    expect(rows).toEqual([]);
  });

  it('filters by kind, and Paid / Unpaid narrow the invoices only', () => {
    const invoices = [
      inv('paid', '2026-09-01', { status: 'paid', totals: { total: 50, balanceDue: 0 } as never }),
      inv('settled', '2026-09-02', { status: 'due', totals: { total: 50, balanceDue: 0 } as never }),
      inv('owing', '2026-09-03'),
      inv('zero', '2026-09-04', { status: 'no_amount', totals: { total: 0, balanceDue: 0 } as never }),
    ];
    const estimates = [est('e1', '2026-09-05')];
    const refs = (show: string) => inboxRows(invoices, estimates, [], parseInboxShow(show)).map((r) => r.ref);
    expect(refs('invoices,paid')).toEqual(['invoice:settled', 'invoice:paid']);
    expect(refs('invoices,unpaid')).toEqual(['invoice:zero', 'invoice:owing']);
    expect(refs('estimates')).toEqual(['estimate:e1']);
    expect(refs('estimates,paid,unpaid')).toEqual(['estimate:e1']);
  });

  it('pages by a cursor that survives a new document arriving at the top', () => {
    const rows = inboxRows(
      Array.from({ length: 25 }, (_, n) => inv(`i${String(n).padStart(2, '0')}`, `2026-09-${String(n + 1).padStart(2, '0')}`)),
      [],
      [],
      ALL,
    );
    const first = pageInboxRows(rows, undefined, 10);
    expect(first.page.map((r) => r.id)).toEqual(['i24', 'i23', 'i22', 'i21', 'i20', 'i19', 'i18', 'i17', 'i16', 'i15']);
    expect(first.nextCursor).toBeDefined();

    const grown = [{ at: '2026-09-30', ref: 'invoice:new', kind: 'invoice' as const, id: 'new' }, ...rows];
    const second = pageInboxRows(grown, decodeInboxCursor(first.nextCursor!), 10);
    expect(second.page[0].id).toBe('i14');
    const third = pageInboxRows(grown, decodeInboxCursor(second.nextCursor!), 10);
    expect(third.page.map((r) => r.id)).toEqual(['i04', 'i03', 'i02', 'i01', 'i00']);
    expect(third.nextCursor).toBeUndefined();
  });

  it('refuses a cursor it did not make', () => {
    expect(() => decodeInboxCursor('not-a-cursor')).toThrow(BadRequestException);
    expect(() => decodeInboxCursor(Buffer.from('{"at":1}').toString('base64url'))).toThrow(BadRequestException);
    expect(decodeInboxCursor(encodeInboxCursor({ at: '2026-09-01', ref: 'invoice:i1' }))).toEqual({ at: '2026-09-01', ref: 'invoice:i1' });
  });
});
