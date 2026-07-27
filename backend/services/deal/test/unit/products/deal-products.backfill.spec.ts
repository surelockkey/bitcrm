import { Test, TestingModule } from '@nestjs/testing';
import { DealProductsBackfill } from 'src/products/deal-products.backfill';
import { DealProductsRepository } from 'src/products/deal-products.repository';

describe('DealProductsBackfill', () => {
  let backfill: DealProductsBackfill;
  let repository: {
    listRowsMissingFulfillment: jest.Mock;
    setFulfillment: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      listRowsMissingFulfillment: jest.fn().mockResolvedValue([]),
      setFulfillment: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DealProductsBackfill,
        { provide: DealProductsRepository, useValue: repository },
      ],
    }).compile();
    backfill = module.get(DealProductsBackfill);
  });

  it("stamps fulfillment='sourced' on every row missing it", async () => {
    repository.listRowsMissingFulfillment.mockResolvedValue([
      { dealId: 'deal-1', productId: 'a' },
      { dealId: 'deal-2', productId: 'b' },
    ]);

    await backfill.onModuleInit();

    expect(repository.setFulfillment).toHaveBeenCalledWith('deal-1', 'a', 'sourced');
    expect(repository.setFulfillment).toHaveBeenCalledWith('deal-2', 'b', 'sourced');
  });

  it('does nothing when no rows need stamping (idempotent)', async () => {
    repository.listRowsMissingFulfillment.mockResolvedValue([]);

    await backfill.onModuleInit();

    expect(repository.setFulfillment).not.toHaveBeenCalled();
  });

  it('swallows errors so a data hiccup never blocks startup', async () => {
    repository.listRowsMissingFulfillment.mockRejectedValue(new Error('dynamo down'));

    await expect(backfill.onModuleInit()).resolves.toBeUndefined();
  });
});
