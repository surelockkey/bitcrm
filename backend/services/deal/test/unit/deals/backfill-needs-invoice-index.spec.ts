import { DealStatus } from '@bitcrm/types';
import { reconcileNeedsInvoice } from '../../../src/scripts/backfill-needs-invoice-index';

/**
 * backfill:needs-invoice-index — a derived projection, so it RECONCILES:
 * keys set where a row qualifies and has none, removed where a row carries
 * them and no longer qualifies. Dry run unless asked to apply; every write
 * guarded on the inputs the scan saw.
 */
describe('backfill:needs-invoice-index', () => {
  const live = (id: string, over: Record<string, unknown> = {}) => ({
    PK: `DEAL#${id}`,
    SK: 'METADATA',
    id,
    status: DealStatus.ACTIVE,
    itemCount: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  });

  function fakeClient(pages: Record<string, unknown>[][], failFor: string[] = []) {
    const updates: any[] = [];
    const puts: any[] = [];
    let page = 0;
    const send = jest.fn(async (cmd: any) => {
      const name = cmd.constructor.name;
      if (name === 'ScanCommand') {
        const items = pages[page] ?? [];
        page += 1;
        return { Items: items, ...(page < pages.length && { LastEvaluatedKey: { page } }) };
      }
      if (name === 'UpdateCommand') {
        if (failFor.includes(cmd.input.Key.PK)) throw Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
        updates.push(cmd.input);
        return {};
      }
      if (name === 'PutCommand') {
        puts.push(cmd.input);
        return {};
      }
      throw new Error(`unexpected ${name}`);
    });
    return { send, updates, puts };
  }

  const rows = () => [
    [
      live('a'), // needs keys
      live('b', { GSI11PK: 'NEEDS_INVOICE', GSI11SK: '2026-09-01T00:00:00.000Z#DEAL#b' }), // correct
      live('c', { invoiceId: 'c', GSI11PK: 'NEEDS_INVOICE', GSI11SK: 'x' }), // stale — remove
    ],
    [live('d', { itemCount: 0 }), live('e', { status: DealStatus.DELETED, GSI11PK: 'NEEDS_INVOICE', GSI11SK: 'y' })],
  ];

  it('a dry run counts what it would do and writes nothing', async () => {
    const { send, updates, puts } = fakeClient(rows());
    const out = await reconcileNeedsInvoice(send as any, { table: 'T', apply: false, log: () => undefined });
    expect(out).toEqual({ scanned: 5, same: 2, set: 1, removed: 2, skipped: 0, qualifying: 2 });
    expect(updates).toHaveLength(0);
    // A dry run never stamps the index ready.
    expect(puts).toHaveLength(0);
  });

  it('--apply sets and removes, each write guarded on the inputs it saw', async () => {
    const { send, updates, puts } = fakeClient(rows());
    const out = await reconcileNeedsInvoice(send as any, { table: 'T', apply: true, log: () => undefined });
    expect(out).toMatchObject({ scanned: 5, same: 2, set: 1, removed: 2, skipped: 0, qualifying: 2 });
    // The complete run stamps NEEDSINVOICEINDEX / STATE — the readers' switch.
    expect(puts).toEqual([
      { TableName: 'T', Item: { PK: 'NEEDSINVOICEINDEX', SK: 'STATE', readyAt: out.readyAt, count: 2 } },
    ]);
    const byPk = Object.fromEntries(updates.map((u) => [u.Key.PK, u]));
    expect(byPk['DEAL#a'].UpdateExpression).toBe('SET GSI11PK = :gsi11pk, GSI11SK = :gsi11sk');
    expect(byPk['DEAL#a'].ConditionExpression).toContain('attribute_not_exists(#ni_invoiceId)');
    expect(byPk['DEAL#c'].UpdateExpression).toBe('REMOVE GSI11PK, GSI11SK');
    expect(byPk['DEAL#e'].UpdateExpression).toBe('REMOVE GSI11PK, GSI11SK');
  });

  it('a run that fails part-way never stamps', async () => {
    const { send, puts } = fakeClient(rows());
    send.mockImplementationOnce(async () => ({ Items: [], LastEvaluatedKey: { page: 1 } })).mockRejectedValueOnce(new Error('throttled'));
    await expect(reconcileNeedsInvoice(send as any, { table: 'T', apply: true, log: () => undefined })).rejects.toThrow('throttled');
    expect(puts).toHaveLength(0);
  });

  it('a row edited mid-run is skipped — its own write already restamped it', async () => {
    const { send } = fakeClient(rows(), ['DEAL#a']);
    const out = await reconcileNeedsInvoice(send as any, { table: 'T', apply: true, log: () => undefined });
    expect(out.skipped).toBe(1);
    expect(out.set).toBe(0);
  });

  it('a second run over the reconciled rows changes nothing', async () => {
    const settled = [[live('b', { GSI11PK: 'NEEDS_INVOICE', GSI11SK: '2026-09-01T00:00:00.000Z#DEAL#b' }), live('d', { itemCount: 0 })]];
    const { send, updates } = fakeClient(settled);
    const out = await reconcileNeedsInvoice(send as any, { table: 'T', apply: true, log: () => undefined });
    expect(out).toMatchObject({ scanned: 2, same: 2, set: 0, removed: 0, skipped: 0, qualifying: 1 });
    expect(updates).toHaveLength(0);
  });
});
