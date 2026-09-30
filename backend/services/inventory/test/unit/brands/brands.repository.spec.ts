import { BrandsRepository } from 'src/brands/brands.repository';
import { createMockDynamoDbService } from '../mocks';

describe('BrandsRepository', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: BrandsRepository;

  const importedRow = {
    PK: 'BRAND#brand-1',
    SK: 'METADATA',
    GSI1PK: 'CATALOG#BRAND',
    GSI1SK: 'slk',
    id: 'brand-1',
    name: 'SLK',
    active: true,
    createdBy: 'workiz-import',
    createdAt: '2026-09-14T00:00:00.000Z',
    updatedAt: '2026-09-14T00:00:00.000Z',
    externalId: 'workiz:brand:1684',
    description: 'ALL ORDERS MADE BY SURE LOCK & KEY',
  };

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new BrandsRepository(dynamoDb as any);
  });

  it('keeps importer attributes (externalId, description) through get() and put()', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({ Item: importedRow }).mockResolvedValueOnce({});

    const brand = await repository.get('brand-1');
    expect(brand).toMatchObject({ name: 'SLK', externalId: 'workiz:brand:1684' });
    expect((brand as unknown as Record<string, unknown>).PK).toBeUndefined();

    await repository.put({ ...brand!, active: false });

    const putItem = dynamoDb.client.send.mock.calls[1][0].input.Item;
    expect(putItem).toMatchObject({
      PK: 'BRAND#brand-1',
      GSI1SK: 'slk',
      active: false,
      externalId: 'workiz:brand:1684',
      description: 'ALL ORDERS MADE BY SURE LOCK & KEY',
    });
  });

  /**
   * Товари тепер несуть `brandId`: бренд, на який посилається хоч одна
   * позиція, архівується, а не видаляється. Індексу за брендом немає —
   * читається розділ Price Book (GSI4 PRODUCTS#ALL) з фільтром, до першого збігу.
   */
  describe('isReferencedByProduct', () => {
    it('answers true at the first page of the Price Book partition that holds the brand', async () => {
      dynamoDb.client.send
        .mockResolvedValueOnce({ Count: 0, LastEvaluatedKey: { PK: 'PRODUCT#p-1' } })
        .mockResolvedValueOnce({ Count: 1, LastEvaluatedKey: { PK: 'PRODUCT#p-2' } });

      expect(await repository.isReferencedByProduct('brand-1')).toBe(true);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input).toMatchObject({
        IndexName: 'TransferEntityIndex',
        KeyConditionExpression: 'GSI4PK = :pk',
        FilterExpression: 'brandId = :brandId',
        ExpressionAttributeValues: { ':pk': 'PRODUCTS#ALL', ':brandId': 'brand-1' },
        Select: 'COUNT',
      });
      expect(dynamoDb.client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ PK: 'PRODUCT#p-1' });
    });

    it('answers false once the partition ends without a match', async () => {
      dynamoDb.client.send
        .mockResolvedValueOnce({ Count: 0, LastEvaluatedKey: { PK: 'PRODUCT#p-1' } })
        .mockResolvedValueOnce({ Count: 0 });

      expect(await repository.isReferencedByProduct('brand-1')).toBe(false);
    });

    // Архівувати бренд, яким ніхто не користується, нешкідливо; видалити той,
    // на який посилаються позиції, — лишити їх з висячим brandId.
    it('answers true — archive, the safe side — when the read budget runs out before the end', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 0, LastEvaluatedKey: { PK: 'PRODUCT#p-1' } });

      expect(await repository.isReferencedByProduct('brand-1')).toBe(true);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(40);
    });
  });
});
