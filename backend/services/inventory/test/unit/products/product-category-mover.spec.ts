import { ProductCategoryMover } from 'src/products/product-category-mover';
import {
  createMockProduct,
  createMockProductsCacheService,
  createMockProductsRepository,
} from '../mocks';

/**
 * Позиції зберігають категорію НАЗВОЮ (і GSI1PK = CATEGORY#<назва>): після
 * перейменування категорії вони лишались на старій назві — фільтр за новою
 * нічого не знаходив. Перейменування переносить кожну позицію старого розділу.
 */
describe('ProductCategoryMover', () => {
  let repository: ReturnType<typeof createMockProductsRepository>;
  let cache: ReturnType<typeof createMockProductsCacheService>;
  let publisher: { publish: jest.Mock };
  let mover: ProductCategoryMover;

  const product = (id: string) => createMockProduct({ id, category: 'Tools & Accessories ' });

  beforeEach(() => {
    repository = createMockProductsRepository();
    repository.update.mockImplementation(async (id: string, attrs: object) => createMockProduct({ id, ...attrs }));
    cache = createMockProductsCacheService();
    publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    mover = new ProductCategoryMover(repository as any, cache as any, publisher as any);
  });

  it('moves every product of the old category, page after page, to the new name', async () => {
    repository.findByCategory
      .mockResolvedValueOnce({ items: [product('p-1'), product('p-2')], nextCursor: 'c-1' })
      .mockResolvedValueOnce({ items: [product('p-3')], nextCursor: undefined });

    expect(await mover.move('Tools & Accessories ', 'Tools & Accessories')).toBe(3);

    // The bare partition: one Query per page, resumed from the cursor it handed out.
    expect(repository.findByCategory.mock.calls).toEqual([
      ['Tools & Accessories ', 100, undefined],
      ['Tools & Accessories ', 100, 'c-1'],
    ]);
    // Through the repository's update, so GSI1 moves and the other indexes re-file.
    expect(repository.update.mock.calls).toEqual([
      ['p-1', { category: 'Tools & Accessories' }],
      ['p-2', { category: 'Tools & Accessories' }],
      ['p-3', { category: 'Tools & Accessories' }],
    ]);
  });

  it('drops each moved product from the cache and tells the search index', async () => {
    repository.findByCategory.mockResolvedValueOnce({ items: [product('p-1'), product('p-2')] });

    await mover.move('Locks', 'Door Locks');

    expect(cache.invalidate.mock.calls).toEqual([['p-1'], ['p-2']]);
    expect(publisher.publish.mock.calls).toEqual([
      ['inventory-events', 'product.updated', { productId: 'p-1' }],
      ['inventory-events', 'product.updated', { productId: 'p-2' }],
    ]);
  });

  it('moves nothing when the old category holds no items', async () => {
    repository.findByCategory.mockResolvedValueOnce({ items: [] });

    expect(await mover.move('Empty', 'Still Empty')).toBe(0);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('reads nothing when the names are the same', async () => {
    expect(await mover.move('Locks', 'Locks')).toBe(0);
    expect(repository.findByCategory).not.toHaveBeenCalled();
  });

  // Перенесені позиції вже на новій назві, решта — на старій: повтор
  // перейменування доносить решту.
  it('stops on a failed write, so repeating the rename moves the rest', async () => {
    repository.findByCategory.mockResolvedValueOnce({ items: [product('p-1')], nextCursor: 'c-1' });
    repository.update.mockRejectedValueOnce(new Error('throttled'));

    await expect(mover.move('Locks', 'Door Locks')).rejects.toThrow('throttled');
    expect(repository.findByCategory).toHaveBeenCalledTimes(1);
  });
});
