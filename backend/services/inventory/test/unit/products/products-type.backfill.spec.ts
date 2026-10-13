import { Test, TestingModule } from '@nestjs/testing';
import { ProductType } from '@bitcrm/types';
import { ProductsTypeBackfill } from 'src/products/products-type.backfill';
import { ProductsRepository } from 'src/products/products.repository';
import { createMockProduct, createMockProductsRepository } from '../mocks';

describe('ProductsTypeBackfill', () => {
  let backfill: ProductsTypeBackfill;
  let repository: ReturnType<typeof createMockProductsRepository>;

  beforeEach(async () => {
    repository = createMockProductsRepository();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsTypeBackfill,
        { provide: ProductsRepository, useValue: repository },
      ],
    }).compile();
    backfill = module.get(ProductsTypeBackfill);
  });

  it("defaults untyped products to 'product' and rebuilds their GSI keys", async () => {
    repository.findAll.mockResolvedValue({
      items: [createMockProduct({ id: 'legacy-1', type: undefined as any })],
      nextCursor: undefined,
    });

    await backfill.onModuleInit();

    expect(repository.update).toHaveBeenCalledWith('legacy-1', {
      type: ProductType.PRODUCT,
    });
  });

  it('is idempotent — skips products that already have a type', async () => {
    repository.findAll.mockResolvedValue({
      items: [createMockProduct({ id: 'prod-1', type: ProductType.SERVICE })],
      nextCursor: undefined,
    });

    await backfill.onModuleInit();

    expect(repository.update).not.toHaveBeenCalled();
  });

  it('pages through every cursor', async () => {
    repository.findAll
      .mockResolvedValueOnce({
        items: [createMockProduct({ id: 'a', type: undefined as any })],
        nextCursor: 'next',
      })
      .mockResolvedValueOnce({
        items: [createMockProduct({ id: 'b', type: undefined as any })],
        nextCursor: undefined,
      });

    await backfill.onModuleInit();

    expect(repository.findAll).toHaveBeenCalledTimes(2);
    expect(repository.update).toHaveBeenCalledTimes(2);
  });

  // The walk reads the whole ~16k-row catalog: on every task start that was a
  // CPU burst on a half-vCPU task, right when the first requests arrive.
  it('walks only until a complete walk has been recorded — then a boot is one GetItem', async () => {
    repository.typeHealDone.mockResolvedValue(true);
    await backfill.onModuleInit();
    expect(repository.findAll).not.toHaveBeenCalled();
  });

  it('records a complete walk, so the next boot skips it', async () => {
    repository.findAll.mockResolvedValue({
      items: [createMockProduct({ id: 'legacy-1', type: undefined as any })],
      nextCursor: undefined,
    });
    await backfill.onModuleInit();
    expect(repository.markTypeHealDone).toHaveBeenCalledTimes(1);
  });

  it('a walk that failed is not recorded', async () => {
    repository.findAll.mockResolvedValue({
      items: [createMockProduct({ id: 'legacy-1', type: undefined as any })],
      nextCursor: undefined,
    });
    repository.update.mockRejectedValue(new Error('throttled'));
    await backfill.onModuleInit();
    expect(repository.markTypeHealDone).not.toHaveBeenCalled();
  });

  it('swallows errors so a data hiccup never blocks startup', async () => {
    repository.findAll.mockRejectedValue(new Error('dynamo down'));

    await expect(backfill.onModuleInit()).resolves.toBeUndefined();
  });
});
