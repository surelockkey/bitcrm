import axios from 'axios';
import { InternalHttpService } from 'src/common/services/internal-http.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('InternalHttpService.getProductsForReport — the price book for a report', () => {
  let inventoryGet: jest.Mock;

  beforeEach(() => {
    inventoryGet = jest.fn();
    mockedAxios.create.mockImplementation((config: any) => {
      if (config.baseURL?.includes('4004')) return { get: inventoryGet, post: jest.fn() } as any;
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
