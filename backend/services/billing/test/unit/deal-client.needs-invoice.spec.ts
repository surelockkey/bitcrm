/* eslint-disable @typescript-eslint/no-explicit-any */
import { DealClient } from 'src/integrations/deal.client';

/**
 * Contract C1 — deal-service's internal needs-invoice routes, which replace
 * the public `GET /deals?needsInvoice=true&limit=100` (a full-table Scan,
 * capped at 100). A deal-service from before them answers 404, and the
 * client says so with `null` so the caller can fall back.
 */
describe('DealClient — needs-invoice (C1)', () => {
  const ok = (data: unknown, pagination?: unknown) => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data, ...(pagination ? { pagination } : {}) }),
  });
  const notFound = { ok: false, status: 404, json: async () => ({ success: false }) };

  it('countNeedsInvoice asks the internal count route with the internal secret', async () => {
    const fetchImpl = jest.fn(async () => ok({ count: 42 }));
    const client = new DealClient(fetchImpl as any);

    await expect(client.countNeedsInvoice()).resolves.toBe(42);

    const [url, init] = (fetchImpl.mock.calls[0] as unknown) as [string, any];
    expect(url).toMatch(/\/api\/deals\/internal\/needs-invoice\/count$/);
    expect(init.headers['x-internal-secret']).toBeDefined();
    expect(init.headers.authorization).toBeUndefined();
  });

  it('countNeedsInvoice answers null on 404 (deal-service not deployed yet)', async () => {
    const client = new DealClient(jest.fn(async () => notFound) as any);
    await expect(client.countNeedsInvoice()).resolves.toBeNull();
  });

  it('listNeedsInvoiceInternal reads one page of the internal list', async () => {
    const rows = [{ id: 'd1', dealNumber: '1', contactId: 'c1', itemCount: 2, createdAt: 't' }];
    const fetchImpl = jest.fn(async () => ok(rows, { nextCursor: 'x' }));
    const client = new DealClient(fetchImpl as any);

    await expect(client.listNeedsInvoiceInternal(100)).resolves.toEqual(rows);

    const [url, init] = (fetchImpl.mock.calls[0] as unknown) as [string, any];
    expect(url).toMatch(/\/api\/deals\/internal\/needs-invoice\?limit=100$/);
    expect(init.headers['x-internal-secret']).toBeDefined();
  });

  it('listNeedsInvoiceInternal answers null on 404', async () => {
    const client = new DealClient(jest.fn(async () => notFound) as any);
    await expect(client.listNeedsInvoiceInternal(100)).resolves.toBeNull();
  });
});
