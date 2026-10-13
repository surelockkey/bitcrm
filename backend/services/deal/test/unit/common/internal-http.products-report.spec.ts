import axios from 'axios';
import { InternalHttpService } from 'src/common/services/internal-http.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('InternalHttpService.getProductsForReport — the per-id fallback', () => {
  let inventoryGet: jest.Mock;

  beforeEach(() => {
    inventoryGet = jest.fn();
    mockedAxios.create.mockImplementation((config: any) => {
      // An inventory deployed before its batch route: the per-id fallback below.
      const noBatch = jest.fn().mockRejectedValue(Object.assign(new Error('Cannot POST'), { response: { status: 404 } }));
      if (config.baseURL?.includes('4004')) return { get: inventoryGet, post: noBatch } as any;
      return { get: jest.fn(), post: jest.fn() } as any;
    });
  });

  it("reads each product on inventory's internal route, once, with the importer's extras kept", async () => {
    inventoryGet.mockImplementation(async (url: string) => {
      const id = url.split('/').pop();
      return { data: { data: { id, name: `Item ${id}`, number: 17011, workizType: 'other', workizSerial: 'S-1' } } };
    });
    const products = await new InternalHttpService().getProductsForReport(['p1', 'p2', 'p1', '']);
    expect(inventoryGet).toHaveBeenCalledTimes(2);
    expect(inventoryGet.mock.calls[0][0]).toBe('/api/inventory/products/internal/p1');
    expect(products.get('p2')).toMatchObject({ name: 'Item p2', workizType: 'other', workizSerial: 'S-1', number: 17011 });
  });

  it('a product inventory does not know, or fails on, is left out — never the report', async () => {
    inventoryGet
      .mockResolvedValueOnce({ data: { data: { id: 'p1', name: 'A' } } })
      .mockRejectedValueOnce(Object.assign(new Error('nf'), { response: { status: 404 } }))
      .mockRejectedValueOnce(new Error('socket hang up'));
    const products = await new InternalHttpService().getProductsForReport(['p1', 'p2', 'p3']);
    expect([...products.keys()]).toEqual(['p1']);
  });

  it('stops asking an inventory that answers nothing but errors', async () => {
    inventoryGet.mockRejectedValue(new Error('ECONNREFUSED'));
    const ids = Array.from({ length: 300 }, (_, i) => `p${i}`);
    const products = await new InternalHttpService().getProductsForReport(ids);
    expect(products.size).toBe(0);
    expect(inventoryGet.mock.calls.length).toBeLessThan(30);
  });
});

/**
 * Inventory's batch route (`POST /products/internal/by-ids`, 500 ids a body)
 * replaces the per-id reads; an inventory not yet deployed with it (404/405)
 * still answers through the old route.
 */
describe('InternalHttpService.getProductsForReport — the batch route', () => {
  let inventoryGet: jest.Mock;
  let inventoryPost: jest.Mock;

  beforeEach(() => {
    inventoryGet = jest.fn();
    inventoryPost = jest.fn();
    mockedAxios.create.mockImplementation((config: any) => {
      if (config.baseURL?.includes('4004')) return { get: inventoryGet, post: inventoryPost } as any;
      return { get: jest.fn(), post: jest.fn() } as any;
    });
  });

  it('asks for 500 ids a body and keeps what came back, by id', async () => {
    inventoryPost.mockImplementation(async (_url: string, body: { ids: string[] }) => ({
      data: { success: true, data: body.ids.filter((id) => id !== 'p7').map((id) => ({ id, name: `Item ${id}`, number: 1 })) },
    }));
    const ids = Array.from({ length: 1200 }, (_, i) => `p${i}`);
    const products = await new InternalHttpService().getProductsForReport([...ids, 'p1', '']);
    expect(inventoryPost).toHaveBeenCalledTimes(3);
    expect(inventoryPost.mock.calls[0][0]).toBe('/api/inventory/products/internal/by-ids');
    expect(inventoryPost.mock.calls.map(([, b]) => b.ids.length)).toEqual([500, 500, 200]);
    expect(products.size).toBe(1199);
    expect(products.has('p7')).toBe(false);
    expect(products.get('p2')).toMatchObject({ name: 'Item p2', number: 1 });
    expect(inventoryGet).not.toHaveBeenCalled();
  });

  it.each([404, 405])('falls back to one read per product when inventory answers %i', async (status) => {
    inventoryPost.mockRejectedValue(Object.assign(new Error('nope'), { response: { status } }));
    inventoryGet.mockImplementation(async (url: string) => ({ data: { data: { id: url.split('/').pop(), name: 'X' } } }));
    const products = await new InternalHttpService().getProductsForReport(['p1', 'p2']);
    expect(inventoryGet).toHaveBeenCalledTimes(2);
    expect([...products.keys()].sort()).toEqual(['p1', 'p2']);
  });

  it('a batch that fails otherwise costs its products, never the report', async () => {
    inventoryPost
      .mockResolvedValueOnce({ data: { data: [{ id: 'p0', name: 'A' }] } })
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { response: { status: 500 } }));
    const ids = Array.from({ length: 600 }, (_, i) => `p${i}`);
    const products = await new InternalHttpService().getProductsForReport(ids);
    expect([...products.keys()]).toEqual(['p0']);
    expect(inventoryGet).not.toHaveBeenCalled();
  });
});
