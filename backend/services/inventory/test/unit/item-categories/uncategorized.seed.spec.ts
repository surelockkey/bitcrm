import { UncategorizedCategorySeed } from 'src/item-categories/uncategorized.seed';
import { createMockCatalogRepository, createMockItemCategoriesService } from '../mocks';

describe('UncategorizedCategorySeed (boot)', () => {
  let repo: ReturnType<typeof createMockCatalogRepository>;
  let categories: ReturnType<typeof createMockItemCategoriesService>;
  let seed: UncategorizedCategorySeed;

  beforeEach(() => {
    repo = createMockCatalogRepository();
    categories = createMockItemCategoriesService();
    seed = new UncategorizedCategorySeed(repo as any, categories as any);
  });

  it('seeds the catalog row when imported products reference "Uncategorized"', async () => {
    repo.isReferencedByProduct.mockResolvedValue(true);
    categories.ensureUncategorized.mockResolvedValue({ category: { name: 'Uncategorized' }, created: true });

    await seed.onModuleInit();

    expect(repo.isReferencedByProduct).toHaveBeenCalledWith('Uncategorized');
    expect(categories.ensureUncategorized).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no product references the sentinel', async () => {
    repo.isReferencedByProduct.mockResolvedValue(false);

    await seed.onModuleInit();

    expect(categories.ensureUncategorized).not.toHaveBeenCalled();
  });

  it('is idempotent — an already seeded row is left alone', async () => {
    repo.isReferencedByProduct.mockResolvedValue(true);
    categories.ensureUncategorized.mockResolvedValue({ category: { name: 'Uncategorized' }, created: false });

    await expect(seed.onModuleInit()).resolves.toBeUndefined();
    expect(categories.ensureUncategorized).toHaveBeenCalledTimes(1);
  });

  it('never blocks startup on an error', async () => {
    repo.isReferencedByProduct.mockRejectedValue(new Error('ResourceNotFoundException'));

    await expect(seed.onModuleInit()).resolves.toBeUndefined();
  });
});
