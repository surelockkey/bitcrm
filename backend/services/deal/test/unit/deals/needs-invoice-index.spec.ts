/**
 * GSI11 NeedsInvoiceIndex — "jobs needing an invoice" (billing's invoice
 * summaries and their list) without a Scan of the deals table.
 *
 *   GSI11PK = NEEDS_INVOICE
 *   GSI11SK = <createdAt>#DEAL#<id>
 *
 * Sparse: present exactly when the row is live (`status = active`), has at
 * least one line (`itemCount > 0`) and no `invoiceId` — the same three terms
 * the `needsInvoice` list filter has always applied. The repository owns it.
 */
import { DealStatus, JobSuperStatus } from '@bitcrm/types';
import { DealsRepository } from '../../../src/deals/deals.repository';
import {
  NEEDS_INVOICE_PK,
  needsInvoiceKeys,
  planNeedsInvoice,
} from '../../../src/deals/needs-invoice-index';
import { createMockDeal, createMockDynamoDbService } from '../mocks';

const row = (over: Record<string, unknown> = {}) => ({
  PK: 'DEAL#d1',
  SK: 'METADATA',
  id: 'd1',
  status: DealStatus.ACTIVE,
  itemCount: 2,
  createdAt: '2026-09-01T12:00:00.000Z',
  ...over,
});

describe('needsInvoiceKeys', () => {
  it('keys a live job with lines and no invoice, newest-sortable by creation', () => {
    expect(needsInvoiceKeys(row())).toEqual({ GSI11PK: NEEDS_INVOICE_PK, GSI11SK: '2026-09-01T12:00:00.000Z#DEAL#d1' });
    expect(NEEDS_INVOICE_PK).toBe('NEEDS_INVOICE');
  });

  it.each([
    ['no lines', { itemCount: 0 }],
    ['an itemCount never stamped (legacy row)', { itemCount: undefined }],
    ['an invoice already', { invoiceId: 'd1' }],
    ['a deleted job', { status: DealStatus.DELETED }],
    ['no status at all', { status: undefined }],
  ])('leaves out a job with %s', (_what, over) => {
    expect(needsInvoiceKeys(row(over))).toBeUndefined();
  });

  it('a canceled job with lines and no invoice still counts — exactly as the list filter always did', () => {
    expect(needsInvoiceKeys(row({ superStatus: JobSuperStatus.CANCELED }))).toBeDefined();
  });
});

describe('planNeedsInvoice — what one row needs', () => {
  it('sets missing keys, leaves correct ones, removes keys a row no longer qualifies for', () => {
    expect(planNeedsInvoice(row())).toEqual({ action: 'set', pk: 'NEEDS_INVOICE', sk: '2026-09-01T12:00:00.000Z#DEAL#d1' });
    expect(planNeedsInvoice(row({ GSI11PK: 'NEEDS_INVOICE', GSI11SK: '2026-09-01T12:00:00.000Z#DEAL#d1' }))).toEqual({ action: 'same' });
    expect(planNeedsInvoice(row({ invoiceId: 'd1', GSI11PK: 'NEEDS_INVOICE', GSI11SK: 'x' }))).toEqual({ action: 'remove' });
    expect(planNeedsInvoice(row({ invoiceId: 'd1' }))).toEqual({ action: 'same' });
  });
});

describe('DealsRepository — maintaining the needs-invoice index', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: DealsRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new DealsRepository(dynamoDb as any);
  });

  const inputs = () => dynamoDb.client.send.mock.calls.map((c: any[]) => c[0].input);

  it('create() writes the keys only when the new job already qualifies', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.create(createMockDeal({ id: 'd1', itemCount: 0 }));
    await repository.create(createMockDeal({ id: 'd2', itemCount: 1, createdAt: '2026-09-02T00:00:00.000Z' }));
    const [a, b] = inputs().map((i: any) => i.Item);
    expect(a.GSI11PK).toBeUndefined();
    expect(b.GSI11PK).toBe('NEEDS_INVOICE');
    expect(b.GSI11SK).toBe('2026-09-02T00:00:00.000Z#DEAL#d2');
  });

  it('a first line on the job files it — guarded on the inputs it was computed from', async () => {
    const after = row({ itemCount: 1 });
    dynamoDb.client.send
      .mockResolvedValueOnce({ Attributes: after })
      .mockResolvedValueOnce({ Attributes: { ...after, GSI11PK: 'NEEDS_INVOICE', GSI11SK: '2026-09-01T12:00:00.000Z#DEAL#d1' } });

    await repository.update('d1', { itemCount: 1 });

    const restamp = inputs()[1];
    expect(restamp.UpdateExpression).toBe('SET GSI11PK = :gsi11pk, GSI11SK = :gsi11sk');
    expect(restamp.ExpressionAttributeValues).toMatchObject({ ':gsi11pk': 'NEEDS_INVOICE', ':gsi11sk': '2026-09-01T12:00:00.000Z#DEAL#d1' });
    // A concurrent write that changed an input since makes this one fail, never land stale.
    expect(restamp.ConditionExpression).toContain('#ni_status = :ni_status');
    expect(restamp.ConditionExpression).toContain('#ni_itemCount = :ni_itemCount');
    expect(restamp.ConditionExpression).toContain('attribute_not_exists(#ni_invoiceId)');
  });

  it.each([
    ['the invoice link', { invoiceId: 'd1' }],
    ['the last line removed', { itemCount: 0 }],
    ['a delete', { status: DealStatus.DELETED }],
  ])('%s takes the job off the index', async (_what, attrs) => {
    const after = row({ ...attrs, GSI11PK: 'NEEDS_INVOICE', GSI11SK: 'k' });
    dynamoDb.client.send.mockResolvedValueOnce({ Attributes: after }).mockResolvedValueOnce({ Attributes: { ...after, GSI11PK: undefined } });

    await repository.update('d1', attrs as any);

    expect(inputs()[1].UpdateExpression).toBe('REMOVE GSI11PK, GSI11SK');
  });

  it('an unlink (invoiceId: null) puts it back', async () => {
    const after = row();
    dynamoDb.client.send.mockResolvedValueOnce({ Attributes: after }).mockResolvedValueOnce({ Attributes: after });
    await repository.update('d1', { invoiceId: null });
    expect(inputs()[1].UpdateExpression).toBe('SET GSI11PK = :gsi11pk, GSI11SK = :gsi11sk');
  });

  it('costs nothing when the keys already match, or the write touches none of the inputs', async () => {
    const filed = row({ GSI11PK: 'NEEDS_INVOICE', GSI11SK: '2026-09-01T12:00:00.000Z#DEAL#d1' });
    dynamoDb.client.send.mockResolvedValue({ Attributes: filed });
    await repository.update('d1', { itemCount: 3 });
    await repository.update('d1', { paymentStatus: 'paid' } as any);
    expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
  });

  it('a lost race re-reads the row and decides again from what is there now', async () => {
    const seen = row({ itemCount: 1 });
    const now = row({ itemCount: 1, invoiceId: 'd1' });
    dynamoDb.client.send
      .mockResolvedValueOnce({ Attributes: seen })
      .mockRejectedValueOnce(Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' }))
      .mockResolvedValueOnce({ Item: now });

    await repository.update('d1', { itemCount: 1 });

    const sent = inputs();
    expect(sent).toHaveLength(3);
    expect(sent[2].ConsistentRead).toBe(true);
    // `now` is invoiced and carries no keys: nothing more to write.
  });

  it('countNeedsInvoice walks the index with Select COUNT to its end', async () => {
    dynamoDb.client.send
      .mockResolvedValueOnce({ Count: 700, LastEvaluatedKey: { k: 1 } })
      .mockResolvedValueOnce({ Count: 42 });

    expect(await repository.countNeedsInvoice()).toBe(742);

    const [first, second] = inputs();
    expect(first.IndexName).toBe('NeedsInvoiceIndex');
    expect(first.Select).toBe('COUNT');
    expect(first.ExpressionAttributeValues[':pk']).toBe('NEEDS_INVOICE');
    expect(second.ExclusiveStartKey).toEqual({ k: 1 });
  });

  it('findNeedsInvoice reads a page of the index, newest first, still filtered as the list is', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({ Items: [{ ...row(), GSI11PK: 'NEEDS_INVOICE', GSI11SK: 's' }] });

    const page = await repository.findNeedsInvoice(50, undefined, { needsInvoice: true, jobTypeId: 'jt1' });

    const q = inputs()[0];
    expect(q.IndexName).toBe('NeedsInvoiceIndex');
    expect(q.ScanIndexForward).toBe(false);
    expect(q.FilterExpression).toContain('#status = :active');
    expect(q.FilterExpression).toContain('#jobTypeId = :jobTypeId');
    expect(page.items.map((d) => d.id)).toEqual(['d1']);
  });

  describe('needsInvoiceIndexReady — the backfill\'s readiness row', () => {
    it('reads NEEDSINVOICEINDEX / STATE; absent is not ready, asked again only after a minute', async () => {
      dynamoDb.client.send.mockResolvedValueOnce({}).mockResolvedValueOnce({ Item: { readyAt: '2026-10-13T08:00:00.000Z', count: 57 } });

      expect(await repository.needsInvoiceIndexReady(1_000)).toBe(false);
      expect(inputs()[0].Key).toEqual({ PK: 'NEEDSINVOICEINDEX', SK: 'STATE' });
      expect(await repository.needsInvoiceIndexReady(50_000)).toBe(false);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);

      expect(await repository.needsInvoiceIndexReady(61_001)).toBe(true);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
    });

    it('once ready, it stays ready — never asked again', async () => {
      dynamoDb.client.send.mockResolvedValueOnce({ Item: { readyAt: '2026-10-13T08:00:00.000Z' } });
      await repository.needsInvoiceIndexReady(0);
      expect(await repository.needsInvoiceIndexReady(10 * 3_600_000)).toBe(true);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });

    it('a read that fails counts as not ready', async () => {
      dynamoDb.client.send.mockRejectedValueOnce(new Error('ECONNRESET'));
      expect(await repository.needsInvoiceIndexReady(0)).toBe(false);
    });
  });
});
