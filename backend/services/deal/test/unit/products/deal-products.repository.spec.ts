import { DealProductsRepository } from 'src/products/deal-products.repository';
import { createMockDynamoDbService, createMockDealProduct } from '../mocks';

describe('DealProductsRepository', () => {
  let repository: DealProductsRepository;
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new DealProductsRepository(dynamoDb as any);
  });

  describe('addProduct', () => {
    it('should send PutCommand with correct PK and SK', async () => {
      const product = createMockDealProduct();
      dynamoDb.client.send.mockResolvedValue({});

      await repository.addProduct('deal-1', product);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      const command = dynamoDb.client.send.mock.calls[0][0];
      const item = command.input.Item;
      expect(item.PK).toBe('DEAL#deal-1');
      expect(item.SK).toBe('PRODUCT#product-1');
    });
  });

  describe('removeProduct', () => {
    it('should send DeleteCommand with correct keys', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.removeProduct('deal-1', 'product-1');

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.Key.PK).toBe('DEAL#deal-1');
      expect(command.input.Key.SK).toBe('PRODUCT#product-1');
    });
  });

  describe('findByDeal', () => {
    it('should query with SK prefix PRODUCT#', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [], Count: 0 });

      await repository.findByDeal('deal-1');

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.ExpressionAttributeValues[':pk']).toBe('DEAL#deal-1');
      expect(command.input.ExpressionAttributeValues[':sk']).toBe('PRODUCT#');
    });
  });

  describe('findProduct', () => {
    it('should get specific product by deal and product id', async () => {
      const product = createMockDealProduct();
      dynamoDb.client.send.mockResolvedValue({
        Item: { PK: 'DEAL#deal-1', SK: 'PRODUCT#product-1', ...product },
      });

      const result = await repository.findProduct('deal-1', 'product-1');

      expect(result).not.toBeNull();
      expect(result!.productId).toBe('product-1');
    });

    it('should return null when product not found', async () => {
      dynamoDb.client.send.mockResolvedValue({ Item: undefined });

      const result = await repository.findProduct('deal-1', 'nonexistent');

      expect(result).toBeNull();
    });
  });
});
