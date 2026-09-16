import { WarehousesRepository } from 'src/warehouses/warehouses.repository';
import { createMockWarehouse, createMockDynamoDbService } from '../mocks';

/**
 * 3 of the 89 Workiz locations import as warehouses, one of them the primary
 * "(1) STORE". `Warehouse` has no `isPrimary`/`externalId`, so the mapper has
 * to carry them or a rename from the UI drops them.
 */
describe('WarehousesRepository (imported rows)', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: WarehousesRepository;

  const importedRow = {
    PK: 'WAREHOUSE#wh-1',
    SK: 'METADATA',
    id: 'wh-1',
    name: '(1) STORE',
    address: '123 Main St',
    status: 'active',
    createdAt: '2026-09-11T11:34:07.000Z',
    updatedAt: '2026-09-11T11:34:07.000Z',
    externalId: 'workiz:location:255',
    isPrimary: true,
  };

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new WarehousesRepository(dynamoDb as any);
  });

  it('keeps the importer attributes and drops the key attributes', async () => {
    dynamoDb.client.send.mockResolvedValue({ Item: importedRow });

    const warehouse = (await repository.findById('wh-1')) as unknown as Record<
      string,
      unknown
    >;

    expect(warehouse).toMatchObject({
      id: 'wh-1',
      name: '(1) STORE',
      externalId: 'workiz:location:255',
      isPrimary: true,
    });
    expect(warehouse.PK).toBeUndefined();
    expect(warehouse.SK).toBeUndefined();
  });

  it('create() writes the extras but always builds its own keys', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    const warehouse = {
      ...createMockWarehouse({ id: 'wh-1' }),
      externalId: 'workiz:location:255',
      isPrimary: true,
      PK: 'WAREHOUSE#tampered',
    };

    await repository.create(warehouse as any);

    const item = dynamoDb.client.send.mock.calls[0][0].input.Item;
    expect(item).toMatchObject({
      PK: 'WAREHOUSE#wh-1',
      SK: 'METADATA',
      externalId: 'workiz:location:255',
      isPrimary: true,
    });
  });

  it('update() returns the extras it did not touch', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Attributes: { ...importedRow, name: 'Main Store' },
    });

    const warehouse = (await repository.update('wh-1', {
      name: 'Main Store',
    })) as unknown as Record<string, unknown>;

    expect(warehouse.name).toBe('Main Store');
    expect(warehouse.isPrimary).toBe(true);
    expect(warehouse.externalId).toBe('workiz:location:255');
  });
});
