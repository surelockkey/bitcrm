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
});
