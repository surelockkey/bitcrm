import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Invoice } from '@bitcrm/types';
import { KEY_ATTRIBUTES, stripKeys, unpaidIndexKeys } from 'src/common/constants/dynamo.constants';
import { InvoicesRepository } from 'src/invoices/invoices.repository';
import { InvoicesService } from 'src/invoices/invoices.service';
import { UnpaidInvoicesRepository } from 'src/invoices/unpaid-invoices.repository';
import { unpaidIndexFix } from 'src/scripts/backfill-unpaid-index';

/**
 * UnpaidIndex — the ~600 invoices that still owe money, on their own sparse
 * index, so Aging, the Invoices cards and the overdue sweep never read the
 * whole 78 000-row list. The keys follow `status` on every write; nobody
 * keeps them by hand.
 */

function fakeDb(answer: (cmd: unknown) => unknown = () => ({})) {
  const sent: unknown[] = [];
  return {
    sent,
    client: {
      send: jest.fn(async (cmd: unknown) => {
        sent.push(cmd);
        return answer(cmd);
      }),
    },
  };
}

const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: 'deal-1',
    number: 'ABC123',
    dealId: 'deal-1',
    contactId: 'c-1',
    invoiceDate: '2026-09-01',
    paymentTerms: 'cash',
    dueDate: '2026-09-01',
    status: 'due',
    totals: { subtotal: 100, taxableSubtotal: 100, nonTaxableSubtotal: 0, discount: 0, taxableBase: 100, taxRatePercent: 0, tax: 0, total: 100, amountPaid: 0, balanceDue: 100, lineCount: 1 },
    version: 1,
    createdBy: 'u-1',
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    ...over,
  }) as Invoice;

describe('unpaidIndexKeys', () => {
  it('files due and overdue invoices, and nothing else', () => {
    expect(unpaidIndexKeys('i-1', 'due')).toEqual({ GSI4PK: 'UNPAID', GSI4SK: 'i-1' });
    expect(unpaidIndexKeys('i-1', 'overdue')).toEqual({ GSI4PK: 'UNPAID', GSI4SK: 'i-1' });
    expect(unpaidIndexKeys('i-1', 'paid')).toBeNull();
    expect(unpaidIndexKeys('i-1', 'no_amount')).toBeNull();
    expect(unpaidIndexKeys('i-1', undefined)).toBeNull();
  });

  it('never leaks the index keys into an entity', () => {
    expect(KEY_ATTRIBUTES).toEqual(expect.arrayContaining(['GSI4PK', 'GSI4SK']));
    expect(stripKeys({ id: 'x', GSI4PK: 'UNPAID', GSI4SK: 'x' })).toEqual({ id: 'x' });
  });
});

describe('InvoicesRepository keeps UnpaidIndex in step with status', () => {
  it('files a new unpaid invoice on create', async () => {
    const db = fakeDb();
    await new InvoicesRepository(db as never).create(invoice({ status: 'due' }));
    const put = db.sent[0] as PutCommand;
    expect(put.input.Item).toMatchObject({ GSI4PK: 'UNPAID', GSI4SK: 'deal-1' });
  });

  it('leaves a paid or empty invoice off the index on create', async () => {
    const db = fakeDb();
    await new InvoicesRepository(db as never).create(invoice({ status: 'no_amount' }));
    const put = db.sent[0] as PutCommand;
    expect(put.input.Item).not.toHaveProperty('GSI4PK');
  });

  it('takes an invoice off the index when a write makes it paid', async () => {
    const db = fakeDb(() => ({ Attributes: invoice({ status: 'paid' }) }));
    await new InvoicesRepository(db as never).update('deal-1', { status: 'paid' }, [], undefined, { bumpVersion: false });
    const upd = db.sent[0] as UpdateCommand;
    expect(upd.input.UpdateExpression).toMatch(/REMOVE .*#r\d/);
    expect(Object.values(upd.input.ExpressionAttributeNames ?? {})).toEqual(expect.arrayContaining(['GSI4PK', 'GSI4SK']));
  });

  it('puts it back when a reversal leaves money owing again', async () => {
    const db = fakeDb(() => ({ Attributes: invoice({ status: 'overdue' }) }));
    await new InvoicesRepository(db as never).update('deal-1', { status: 'overdue' });
    const upd = db.sent[0] as UpdateCommand;
    const values = Object.values(upd.input.ExpressionAttributeValues ?? {});
    expect(values).toEqual(expect.arrayContaining(['UNPAID', 'deal-1']));
    expect(upd.input.UpdateExpression).not.toMatch(/REMOVE/);
  });

  it('does not touch the index on a write that says nothing about status', async () => {
    const db = fakeDb(() => ({ Attributes: invoice() }));
    await new InvoicesRepository(db as never).update('deal-1', { sentAt: '2026-09-02T00:00:00.000Z' });
    const upd = db.sent[0] as UpdateCommand;
    expect(Object.values(upd.input.ExpressionAttributeNames ?? {})).not.toContain('GSI4PK');
  });
});

describe('UnpaidInvoicesRepository', () => {
  it('reads the index once the backfill has stamped it', async () => {
    const db = fakeDb((cmd) => {
      if (cmd instanceof GetCommand) return { Item: { readyAt: '2026-09-30T00:00:00.000Z' } };
      if (cmd instanceof QueryCommand) return { Items: [{ ...invoice(), GSI4PK: 'UNPAID', GSI4SK: 'deal-1', PK: 'INVOICE#deal-1', SK: 'METADATA' }] };
      return {};
    });
    const repo = new UnpaidInvoicesRepository(db as never);
    const out = await repo.listUnpaid();
    expect(out.indexReady).toBe(true);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).not.toHaveProperty('GSI4PK');
    const query = db.sent.find((c) => c instanceof QueryCommand) as QueryCommand;
    expect(query.input.IndexName).toBe('UnpaidIndex');
  });

  it('falls back to the filtered list before the backfill has run', async () => {
    const db = fakeDb((cmd) => {
      if (cmd instanceof GetCommand) return {};
      if (cmd instanceof QueryCommand) return { Items: [invoice()] };
      return {};
    });
    const out = await new UnpaidInvoicesRepository(db as never).listUnpaid();
    expect(out.indexReady).toBe(false);
    const query = db.sent.find((c) => c instanceof QueryCommand) as QueryCommand;
    expect(query.input.IndexName).toBe('ListIndex');
    expect(query.input.FilterExpression).toBe('#status IN (:due, :overdue)');
  });

  it('asks for the state row once, then trusts it', async () => {
    const db = fakeDb((cmd) => (cmd instanceof GetCommand ? { Item: { readyAt: 'x' } } : { Items: [] }));
    const repo = new UnpaidInvoicesRepository(db as never);
    await repo.isReady();
    await repo.isReady();
    expect(db.sent.filter((c) => c instanceof GetCommand)).toHaveLength(1);
  });

  it('marks itself ready when the backfill stamps the state row', async () => {
    const db = fakeDb();
    const repo = new UnpaidInvoicesRepository(db as never);
    await repo.markReady(547, '2026-09-30T00:00:00.000Z');
    expect((db.sent[0] as PutCommand).input.Item).toMatchObject({ PK: 'UNPAIDINDEX', SK: 'STATE', count: 547 });
    await expect(repo.isReady()).resolves.toBe(true);
  });
});

describe('backfill:unpaid-index — what one row needs', () => {
  it('files an open invoice that lacks its keys', () => {
    expect(unpaidIndexFix({ PK: 'INVOICE#a', id: 'a', status: 'overdue' })).toEqual({ set: { GSI4PK: 'UNPAID', GSI4SK: 'a' } });
  });
  it('takes a paid invoice off the index', () => {
    expect(unpaidIndexFix({ PK: 'INVOICE#a', id: 'a', status: 'paid', GSI4PK: 'UNPAID', GSI4SK: 'a' })).toEqual({ remove: true });
  });
  it('leaves a correct row alone (idempotent)', () => {
    expect(unpaidIndexFix({ PK: 'INVOICE#a', id: 'a', status: 'due', GSI4PK: 'UNPAID', GSI4SK: 'a' })).toBeNull();
    expect(unpaidIndexFix({ PK: 'INVOICE#a', id: 'a', status: 'paid' })).toBeNull();
  });
});

describe('InvoicesService.sweepOverdue off UnpaidIndex', () => {
  it('flips only due invoices past their due date, without reading the whole list', async () => {
    const rows = [
      invoice({ id: 'a', status: 'due', dueDate: '2026-09-10' }),
      invoice({ id: 'b', status: 'due', dueDate: '2026-09-30' }),
      invoice({ id: 'c', status: 'overdue', dueDate: '2026-08-01' }),
    ];
    const repo = {
      listAll: jest.fn(),
      update: jest.fn(async (id: string, set: Partial<Invoice>) => ({ ...rows.find((r) => r.id === id)!, ...set })),
    };
    const unpaid = { isReady: jest.fn(async () => true), listUnpaid: jest.fn(async () => ({ items: rows, indexReady: true })) };
    const service = new InvoicesService(
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      undefined,
      unpaid as never,
    );
    await expect(service.sweepOverdue('2026-09-20')).resolves.toBe(1);
    expect(repo.update).toHaveBeenCalledWith('a', expect.objectContaining({ status: 'overdue' }), [], undefined, { bumpVersion: false });
    expect(repo.listAll).not.toHaveBeenCalled();
  });

  it('keeps the old full read while the index is not built', async () => {
    const repo = { listAll: jest.fn(async () => []), update: jest.fn() };
    const unpaid = { isReady: jest.fn(async () => false), listUnpaid: jest.fn() };
    const service = new InvoicesService(repo as never, {} as never, {} as never, {} as never, undefined, undefined, undefined, undefined, unpaid as never);
    await service.sweepOverdue('2026-09-20');
    expect(repo.listAll).toHaveBeenCalled();
    expect(unpaid.listUnpaid).not.toHaveBeenCalled();
  });
});
