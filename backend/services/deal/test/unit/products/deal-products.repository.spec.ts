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
      // The line's own id is the key, not the product it names.
      expect(item.SK).toBe('PRODUCT#line-1');
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

    it('maps sourceTechId, fulfillment, and orderedAt out of the item', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Item: {
          PK: 'DEAL#deal-1',
          SK: 'PRODUCT#product-1',
          productId: 'product-1',
          name: 'Deadbolt',
          sku: 'KW-001',
          quantity: 1,
          costCompany: 15,
          costForTech: 20,
          priceClient: 45,
          sourceTechId: 'tech-7',
          fulfillment: 'to_order',
          orderedAt: '2026-07-27T00:00:00.000Z',
          addedBy: 'tech-1',
          addedAt: '2026-07-01T00:00:00.000Z',
        },
      });

      const result = await repository.findProduct('deal-1', 'product-1');

      expect(result!.sourceTechId).toBe('tech-7');
      expect(result!.fulfillment).toBe('to_order');
      expect(result!.orderedAt).toBe('2026-07-27T00:00:00.000Z');
    });

    it("reads an imported Workiz line back with both of its markers", async () => {
      // 47 976 product lines carry fulfillment='imported'; the service lines
      // stay fulfillment='service' and are marked through priceSource.
      dynamoDb.client.send.mockResolvedValue({
        Item: {
          PK: 'DEAL#deal-1',
          SK: 'PRODUCT#product-1',
          productId: 'product-1',
          name: 'Deadbolt',
          sku: 'WZ-10707',
          quantity: 0.5,
          costCompany: 15,
          costForTech: 20,
          priceClient: 5,
          fulfillment: 'imported',
          priceSource: 'imported',
          addedBy: 'workiz-import',
          addedAt: '2021-03-04T00:00:00.000Z',
        },
      });

      const result = await repository.findProduct('deal-1', 'product-1');

      expect(result!.fulfillment).toBe('imported');
      expect(result!.priceSource).toBe('imported');
      // Workiz has 762 fractional line quantities — read back verbatim.
      expect(result!.quantity).toBe(0.5);
    });

    it('leaves priceSource undefined on every line BitCRM wrote itself', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Item: {
          PK: 'DEAL#deal-1',
          SK: 'PRODUCT#product-1',
          productId: 'product-1',
          name: 'Deadbolt',
          sku: 'KW-001',
          quantity: 1,
          costCompany: 15,
          costForTech: 20,
          priceClient: 45,
          fulfillment: 'sourced',
          addedBy: 'tech-1',
          addedAt: '2026-07-01T00:00:00.000Z',
        },
      });

      const result = await repository.findProduct('deal-1', 'product-1');

      expect(result!.priceSource).toBeUndefined();
    });

    it("defaults a missing fulfillment to 'sourced' (legacy rows)", async () => {
      dynamoDb.client.send.mockResolvedValue({
        Item: {
          PK: 'DEAL#deal-1',
          SK: 'PRODUCT#product-1',
          productId: 'product-1',
          name: 'Deadbolt',
          sku: 'KW-001',
          quantity: 1,
          costCompany: 15,
          costForTech: 20,
          priceClient: 45,
          addedBy: 'tech-1',
          addedAt: '2026-07-01T00:00:00.000Z',
        },
      });

      const result = await repository.findProduct('deal-1', 'product-1');

      expect(result!.fulfillment).toBe('sourced');
    });
  });

  describe('billing fields', () => {
    it('maps taxable (absent ⇒ true) and description', async () => {
      const base = { PK: 'DEAL#deal-1', SK: 'PRODUCT#product-1', ...createMockDealProduct() };
      dynamoDb.client.send
        .mockResolvedValueOnce({ Item: base })
        .mockResolvedValueOnce({ Item: { ...base, taxable: false, description: 'Rekey 2 locks' } });

      const legacy = await repository.findProduct('deal-1', 'product-1');
      const flagged = await repository.findProduct('deal-1', 'product-1');

      expect(legacy!.taxable).toBe(true);
      expect(flagged!.taxable).toBe(false);
      expect(flagged!.description).toBe('Rekey 2 locks');
    });

    it('setTaxable updates the flag on an existing line and returns it', async () => {
      const item = { PK: 'DEAL#deal-1', SK: 'PRODUCT#product-1', ...createMockDealProduct(), taxable: false };
      dynamoDb.client.send.mockResolvedValue({ Attributes: item });

      const line = await repository.setTaxable('deal-1', 'product-1', false);

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.Key).toEqual({ PK: 'DEAL#deal-1', SK: 'PRODUCT#product-1' });
      expect(input.UpdateExpression).toContain('taxable = :t');
      expect(input.ExpressionAttributeValues[':t']).toBe(false);
      expect(input.ConditionExpression).toBe('attribute_exists(PK)');
      expect(line.taxable).toBe(false);
    });

    it('countByDeal counts PRODUCT# rows across pages', async () => {
      dynamoDb.client.send
        .mockResolvedValueOnce({ Count: 2, LastEvaluatedKey: { PK: 'x' } })
        .mockResolvedValueOnce({ Count: 1 });

      expect(await repository.countByDeal('deal-1')).toBe(3);
      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.Select).toBe('COUNT');
      expect(input.ExpressionAttributeValues[':sk']).toBe('PRODUCT#');
    });
  });

  describe('setOrderedAt', () => {
    it('sets orderedAt with a value', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.setOrderedAt('deal-1', 'product-1', '2026-07-27T00:00:00.000Z');

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.UpdateExpression).toContain('SET orderedAt');
      expect(command.input.ExpressionAttributeValues[':o']).toBe('2026-07-27T00:00:00.000Z');
    });

    it('removes orderedAt when null', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.setOrderedAt('deal-1', 'product-1', null);

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.UpdateExpression).toContain('REMOVE orderedAt');
    });
  });

  describe('listRowsMissingFulfillment', () => {
    it('scans PRODUCT# rows lacking fulfillment and paginates', async () => {
      dynamoDb.client.send
        .mockResolvedValueOnce({
          Items: [{ PK: 'DEAL#deal-1', SK: 'PRODUCT#a', productId: 'a' }],
          LastEvaluatedKey: { PK: 'x' },
        })
        .mockResolvedValueOnce({
          Items: [{ PK: 'DEAL#deal-2', SK: 'PRODUCT#b', productId: 'b' }],
          LastEvaluatedKey: undefined,
        });

      const rows = await repository.listRowsMissingFulfillment();

      // The key each row actually lives under — so the stamp lands on it.
      expect(rows).toEqual([
        { dealId: 'deal-1', lineKey: 'a' },
        { dealId: 'deal-2', lineKey: 'b' },
      ]);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.FilterExpression).toContain('attribute_not_exists(fulfillment)');
    });
  });
});
