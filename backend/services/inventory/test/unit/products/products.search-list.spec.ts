/**
 * A filtered Price Book (`GET /products`, `/products/count` with search,
 * status, type, brand, stock level… and no category) reads search-service's
 * read model instead of walking the ~16 MB `PRODUCTS#ALL` partition; the
 * rows themselves still come from here (product cache, then BatchGet), and
 * the cursor is the very one the DynamoDB path hands out, so either path can
 * continue the other. Unfiltered and category browsing stay on DynamoDB, and
 * any answer search cannot give falls back to it.
 */
import { ProductsService } from 'src/products/products.service';
import { createMockProduct, createMockProductsCacheService, createMockProductsRepository } from '../mocks';

const encode = (key: Record<string, unknown>) => Buffer.from(JSON.stringify(key)).toString('base64url');
const decode = (cursor: string) => JSON.parse(Buffer.from(cursor, 'base64url').toString());

describe('ProductsService — the filtered Price Book off the read model', () => {
  let repository: ReturnType<typeof createMockProductsRepository>;
  let cache: ReturnType<typeof createMockProductsCacheService>;
  let listSearch: { page: jest.Mock; count: jest.Mock };
  let service: ProductsService;

  beforeEach(() => {
    repository = createMockProductsRepository();
    cache = createMockProductsCacheService();
    listSearch = { page: jest.fn(), count: jest.fn() };
    service = new ProductsService(
      repository as any,
      cache as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      listSearch as any,
    );
  });

  it('an unfiltered Price Book stays one DynamoDB Query — search is not asked', async () => {
    repository.findCatalog.mockResolvedValue({ items: [] });
    await service.list({ limit: 20 } as any);
    expect(listSearch.page).not.toHaveBeenCalled();
    expect(repository.findCatalog).toHaveBeenCalled();
  });

  it('category browsing stays on the CategoryIndex, filters and all', async () => {
    repository.findByCategory.mockResolvedValue({ items: [] });
    await service.list({ category: 'Locks', status: 'active', limit: 20 } as any);
    expect(listSearch.page).not.toHaveBeenCalled();
  });

  it('manageStock=true alone is the stock partition read as it is — search is not asked', async () => {
    repository.findStockManaged.mockResolvedValue({ items: [] });
    await service.list({ manageStock: true, limit: 10 } as any);
    expect(listSearch.page).not.toHaveBeenCalled();
    expect(repository.findStockManaged).toHaveBeenCalled();
  });

  it('a filtered Price Book: ids from search, rows from here in that order, the DynamoDB cursor', async () => {
    listSearch.page.mockResolvedValue({ ids: ['p2', 'p1'], next: 'bolt#p1' });
    repository.findByIds.mockResolvedValue([
      createMockProduct({ id: 'p1', name: 'Bolt', status: 'active' as any }),
      createMockProduct({ id: 'p2', name: 'Anchor', status: 'active' as any }),
    ]);

    const page = await service.list({ status: 'active', search: 'o', limit: 2 } as any);

    expect(listSearch.page).toHaveBeenCalledWith('catalog', { status: 'active', search: 'o' }, 2, undefined);
    expect(page.items.map((p) => p.id)).toEqual(['p2', 'p1']);
    expect(decode(page.nextCursor!)).toEqual({ PK: 'PRODUCT#p1', SK: 'METADATA', GSI4PK: 'PRODUCTS#ALL', GSI4SK: 'bolt#p1' });
    expect(repository.findCatalog).not.toHaveBeenCalled();
  });

  it('resumes from a cursor either path handed out (its GSI4SK is the sort key to search after)', async () => {
    listSearch.page.mockResolvedValue({ ids: [] });
    const cursor = encode({ PK: 'PRODUCT#p9', SK: 'METADATA', GSI4PK: 'PRODUCTS#ALL', GSI4SK: 'kwikset#p9' });
    const page = await service.list({ type: 'service', limit: 20, cursor } as any);
    expect(listSearch.page).toHaveBeenCalledWith('catalog', { type: 'service' }, 20, 'kwikset#p9');
    expect(page).toEqual({ items: [], nextCursor: undefined });
  });

  it('manageStock=true with a filter reads the stock partition there, with GSI3 cursors', async () => {
    listSearch.page.mockResolvedValue({ ids: ['p1'], next: 'bolt#p1' });
    repository.findByIds.mockResolvedValue([createMockProduct({ id: 'p1', status: 'active' as any })]);
    const cursor = encode({ PK: 'PRODUCT#p0', SK: 'METADATA', GSI3PK: 'PRODUCTS#STOCK', GSI3SK: 'anchor#p0' });

    const page = await service.list({ manageStock: true, status: 'active', limit: 1, cursor } as any);

    expect(listSearch.page).toHaveBeenCalledWith('stock', { status: 'active' }, 1, 'anchor#p0');
    expect(decode(page.nextCursor!)).toEqual({ PK: 'PRODUCT#p1', SK: 'METADATA', GSI3PK: 'PRODUCTS#STOCK', GSI3SK: 'bolt#p1' });
  });

  it('manageStock=false and the stock level are search filters on the Price Book', async () => {
    listSearch.page.mockResolvedValue({ ids: [] });
    await service.list({ manageStock: false, stockLevel: 'low', limit: 20 } as any);
    expect(listSearch.page).toHaveBeenCalledWith('catalog', { manageStock: false, stockLevel: 'low' }, 20, undefined);
  });

  it('a row that changed since search indexed it is checked against the filters and left out', async () => {
    listSearch.page.mockResolvedValue({ ids: ['p1', 'p2'] });
    repository.findByIds.mockResolvedValue([
      createMockProduct({ id: 'p1', status: 'archived' as any }),
      createMockProduct({ id: 'p2', status: 'active' as any }),
    ]);
    const page = await service.list({ status: 'active', limit: 20 } as any);
    expect(page.items.map((p) => p.id)).toEqual(['p2']);
  });

  it('no answer from search (off, not ready, failed) → the DynamoDB walk, unchanged', async () => {
    listSearch.page.mockResolvedValue(null);
    repository.findCatalog.mockResolvedValue({ items: [], nextCursor: 'c' });
    const page = await service.list({ status: 'active', limit: 20, cursor: undefined } as any);
    expect(repository.findCatalog).toHaveBeenCalledWith(20, undefined, expect.objectContaining({ status: 'active' }));
    expect(page.nextCursor).toBe('c');
  });

  it('a cursor of the other partition is the same 400 the DynamoDB path gives', async () => {
    const stockCursor = encode({ PK: 'PRODUCT#p0', SK: 'METADATA', GSI3PK: 'PRODUCTS#STOCK', GSI3SK: 'a#p0' });
    await expect(service.list({ status: 'active', limit: 20, cursor: stockCursor } as any)).rejects.toMatchObject({ status: 400 });
  });

  describe('count', () => {
    it('a filtered count is search\'s exact total', async () => {
      listSearch.count.mockResolvedValue(1234);
      expect(await service.count({ status: 'active', search: 'lock' } as any)).toEqual({ total: 1234, atLeast: false });
      expect(listSearch.count).toHaveBeenCalledWith('catalog', { status: 'active', search: 'lock' });
      expect(repository.countCatalog).not.toHaveBeenCalled();
    });

    it('the stock partition with a filter too', async () => {
      listSearch.count.mockResolvedValue(9);
      await service.count({ manageStock: true, stockLevel: 'low' } as any);
      expect(listSearch.count).toHaveBeenCalledWith('stock', { stockLevel: 'low' });
    });

    it('falls back to the DynamoDB count; an unfiltered or category count never asks search', async () => {
      listSearch.count.mockResolvedValue(null);
      repository.countCatalog.mockResolvedValue({ total: 5, atLeast: false });
      expect(await service.count({ status: 'active' } as any)).toEqual({ total: 5, atLeast: false });

      repository.countByCategory.mockResolvedValue({ total: 2, atLeast: false });
      listSearch.count.mockClear();
      await service.count({ category: 'Locks', status: 'active' } as any);
      await service.count({} as any);
      expect(listSearch.count).not.toHaveBeenCalled();
    });
  });
});
