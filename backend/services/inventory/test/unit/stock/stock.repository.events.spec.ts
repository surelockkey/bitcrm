/**
 * A stock write that moves a product's `onHand` publishes `product.updated`
 * on inventory-events, so search rebuilds the product document — its
 * `productList.stockLevel` (Workiz's Stocked / Low) is what the Price Book's
 * stock-level filter reads off the read model. Fire-and-forget: a failed
 * publish never fails the write.
 */
import { StockRepository } from 'src/stock/stock.repository';
import { createMockDynamoDbService, createMockRedisService } from '../mocks';

function canceled(codes: string[]): Error {
  const error = new Error('Transaction cancelled');
  error.name = 'TransactionCanceledException';
  (error as Error & { CancellationReasons: { Code: string }[] }).CancellationReasons = codes.map((Code) => ({ Code }));
  return error;
}

const flush = () => new Promise((r) => setImmediate(r));

describe('StockRepository — onHand changes reach the read model', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let publisher: { publish: jest.Mock };
  let repository: StockRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    repository = new StockRepository(dynamoDb as any, createMockRedisService() as any, publisher as any);
  });

  it('a receipt publishes product.updated for the product whose onHand moved', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.incrementStock('WAREHOUSE#wh-1', 'prod-1', 'Lock', 5);
    await flush();
    expect(publisher.publish).toHaveBeenCalledWith('inventory-events', 'product.updated', {
      productId: 'prod-1',
      fields: ['onHand'],
    });
  });

  it('a deduction does too', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.decrementStock('CONTAINER#c-1', 'prod-2', 1);
    await flush();
    expect(publisher.publish).toHaveBeenCalledWith('inventory-events', 'product.updated', {
      productId: 'prod-2',
      fields: ['onHand'],
    });
  });

  it('a move between locations leaves onHand alone and publishes nothing', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.moveStock('WAREHOUSE#wh-1', 'CONTAINER#c-1', 'prod-1', 'Lock', 2);
    await flush();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('a product with no onHand yet (refused part) publishes nothing', async () => {
    dynamoDb.client.send
      .mockRejectedValueOnce(canceled(['None', 'ConditionalCheckFailed', 'ConditionalCheckFailed']))
      .mockResolvedValueOnce({});
    await repository.incrementStock('WAREHOUSE#wh-1', 'ghost', 'Ghost', 5);
    await flush();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('a failed publish never fails the stock write; no publisher at all is fine', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    publisher.publish.mockRejectedValue(new Error('SNS down'));
    await expect(repository.incrementStock('WAREHOUSE#wh-1', 'prod-1', 'Lock', 5)).resolves.toBeUndefined();
    await flush();

    const bare = new StockRepository(dynamoDb as any);
    await expect(bare.incrementStock('WAREHOUSE#wh-1', 'prod-1', 'Lock', 5)).resolves.toBeUndefined();
  });
});
