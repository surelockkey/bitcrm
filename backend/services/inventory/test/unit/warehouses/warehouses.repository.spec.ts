import { WarehousesRepository } from 'src/warehouses/warehouses.repository';
import { InventoryStatus } from '@bitcrm/types';
import { createMockWarehouse, createMockDynamoDbService } from '../mocks';

const decodeCursor = (cursor: string) =>
  JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
const encodeCursor = (key: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(key)).toString('base64url');

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

  it('create() writes the location index keys', async () => {
    dynamoDb.client.send.mockResolvedValue({});

    await repository.create(createMockWarehouse({ id: 'wh-1', name: ' (1) STORE' }));

    const item = dynamoDb.client.send.mock.calls[0][0].input.Item;
    expect(item.GSI1PK).toBe('LOCATION#WAREHOUSE');
    expect(item.GSI1SK).toBe('(1) store#wh-1');
  });

  it('update() rewrites the index sort key when the name changes', async () => {
    dynamoDb.client.send.mockResolvedValue({ Attributes: { ...importedRow, name: 'Main Store' } });

    await repository.update('wh-1', { name: 'Main Store' });

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.UpdateExpression).toContain('#GSI1SK = :GSI1SK');
    expect(input.ExpressionAttributeValues[':GSI1SK']).toBe('main store#wh-1');
    expect(input.ExpressionAttributeValues[':GSI1PK']).toBe('LOCATION#WAREHOUSE');
  });

  it('update() leaves the index sort key alone when the name is not among the attrs', async () => {
    dynamoDb.client.send.mockResolvedValue({ Attributes: importedRow });

    await repository.update('wh-1', { address: '9 Elm St' });

    expect(dynamoDb.client.send.mock.calls[0][0].input.UpdateExpression).not.toContain('GSI1');
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

/**
 * Таблиця інвентарю спільна для товарів, SKU, залишків, фургонів і складів,
 * тож фільтрований Scan читав здебільшого чуже і вичерпував бюджет читань до
 * повної сторінки. Склади тепер читаються з індексу локацій — лише свої рядки,
 * за назвою.
 */
describe('WarehousesRepository.findAll', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: WarehousesRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new WarehousesRepository(dynamoDb as any);
  });

  const row = (id: string) => ({
    ...createMockWarehouse(),
    id,
    PK: `WAREHOUSE#${id}`,
    SK: 'METADATA',
    GSI1PK: 'LOCATION#WAREHOUSE',
    GSI1SK: `main warehouse#${id}`,
  });

  it('queries the location index in name order instead of scanning the table', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [row('w1')] });

    await repository.findAll(20);

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(dynamoDb.client.send.mock.calls[0][0].constructor.name).toBe('QueryCommand');
    expect(input.IndexName).toBe('CategoryIndex');
    expect(input.KeyConditionExpression).toBe('GSI1PK = :pk');
    expect(input.ExpressionAttributeValues[':pk']).toBe('LOCATION#WAREHOUSE');
    expect(input.ScanIndexForward).toBe(true);
    expect(input.FilterExpression).toBeUndefined();
  });

  it('filters by status and a trimmed, lowercased search term', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [] });

    await repository.findAll(20, undefined, { status: InventoryStatus.ARCHIVED, search: ' Store ' });

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.FilterExpression).toContain('#status = :status');
    expect(input.FilterExpression).toContain('contains(GSI1SK, :search)');
    expect(input.ExpressionAttributeNames).toEqual({ '#status': 'status' });
    expect(input.ExpressionAttributeValues).toEqual({
      ':pk': 'LOCATION#WAREHOUSE',
      ':status': 'archived',
      ':search': 'store',
    });
  });

  it('fills the page across reads', async () => {
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [row('w1')], LastEvaluatedKey: { PK: 'X#1', SK: 'METADATA' } })
      .mockResolvedValueOnce({ Items: [row('w2')], LastEvaluatedKey: undefined });

    const result = await repository.findAll(3);

    expect(result.items.map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(result.nextCursor).toBeUndefined();
  });

  it('hands back a cursor with the index keys when a read overshoots the page', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Items: [row('w1'), row('w2'), row('w3')],
      LastEvaluatedKey: { PK: 'WAREHOUSE#w3', SK: 'METADATA', GSI1PK: 'LOCATION#WAREHOUSE', GSI1SK: 'main warehouse#w3' },
    });

    const result = await repository.findAll(2);

    expect(result.items.map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(decodeCursor(result.nextCursor!)).toEqual({
      PK: 'WAREHOUSE#w2',
      SK: 'METADATA',
      GSI1PK: 'LOCATION#WAREHOUSE',
      GSI1SK: 'main warehouse#w2',
    });
  });

  it('resumes from the cursor it handed out', async () => {
    const key = { PK: 'WAREHOUSE#w2', SK: 'METADATA', GSI1PK: 'LOCATION#WAREHOUSE', GSI1SK: 'main warehouse#w2' };
    dynamoDb.client.send.mockResolvedValue({ Items: [row('w3')] });

    await repository.findAll(2, encodeCursor(key));

    expect(dynamoDb.client.send.mock.calls[0][0].input.ExclusiveStartKey).toEqual(key);
  });

  describe('countAll', () => {
    it('counts the index partition without pulling item bodies back', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 3 });

      expect(await repository.countAll()).toEqual({ total: 3, atLeast: false });
      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.Select).toBe('COUNT');
      expect(input.IndexName).toBe('CategoryIndex');
      expect(input.KeyConditionExpression).toBe('GSI1PK = :pk');
      expect(input.ExpressionAttributeValues[':pk']).toBe('LOCATION#WAREHOUSE');
    });

    it('counts under the same filter the list uses', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 1 });

      await repository.countAll({ search: 'Store', status: InventoryStatus.ACTIVE });

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.FilterExpression).toContain('contains(GSI1SK, :search)');
      expect(input.FilterExpression).toContain('#status = :status');
      expect(input.ExpressionAttributeValues[':search']).toBe('store');
    });

    it('gives up on an exact answer rather than walk the whole index', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Count: 1,
        LastEvaluatedKey: { PK: 'X#1', SK: 'METADATA' },
      });

      expect((await repository.countAll()).atLeast).toBe(true);
    });
  });
});

