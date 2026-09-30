import { BadRequestException } from '@nestjs/common';
import { ContainersRepository } from 'src/containers/containers.repository';
import { InventoryStatus } from '@bitcrm/types';
import { createMockContainer, createMockDynamoDbService } from '../mocks';

const decodeCursor = (cursor: string) =>
  JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
const encodeCursor = (key: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(key)).toString('base64url');

/**
 * 86 of the 89 Workiz locations import as containers; 59 have a technician and
 * 7 carry secondary users. The importer writes attributes `Container` does not
 * declare (`externalId`, `isPrimary`, `userLimited`, `accessUserIds`) — the
 * mapper must carry them or the first edit from the UI erases them.
 */
describe('ContainersRepository (imported rows)', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: ContainersRepository;

  const importedRow = {
    PK: 'CONTAINER#container-1',
    SK: 'METADATA',
    GSI1PK: 'LOCATION#CONTAINER',
    GSI1SK: '(12) mike#container-1',
    searchName: '(12) mike',
    GSI3PK: 'OWNER#tech-1',
    GSI3SK: 'CONTAINER#container-1',
    id: 'container-1',
    name: '(12) MIKE',
    technicianId: 'tech-1',
    technicianName: 'Mike Ross',
    department: 'Atlanta',
    status: 'active',
    createdAt: '2026-09-11T11:34:07.000Z',
    updatedAt: '2026-09-11T11:34:07.000Z',
    externalId: 'workiz:location:8877',
    isPrimary: false,
    userLimited: true,
    accessUserIds: ['user-4', 'user-9'],
  };

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new ContainersRepository(dynamoDb as any);
  });

  it('keeps the importer attributes on the entity', async () => {
    dynamoDb.client.send.mockResolvedValue({ Item: importedRow });

    const container = (await repository.findById('container-1')) as unknown as Record<
      string,
      unknown
    >;

    expect(container).toMatchObject({
      id: 'container-1',
      technicianId: 'tech-1',
      externalId: 'workiz:location:8877',
      isPrimary: false,
      userLimited: true,
      accessUserIds: ['user-4', 'user-9'],
    });
  });

  it('never leaks the DynamoDB key attributes', async () => {
    dynamoDb.client.send.mockResolvedValue({ Item: importedRow });

    const container = (await repository.findById('container-1')) as unknown as Record<
      string,
      unknown
    >;

    expect(container.PK).toBeUndefined();
    expect(container.GSI3PK).toBeUndefined();
    expect(container.GSI3SK).toBeUndefined();
    expect(container.searchName).toBeUndefined();
  });

  it('keeps the name fallback for a row written before containers had one', async () => {
    const { name: _dropped, ...noName } = importedRow;
    dynamoDb.client.send.mockResolvedValue({ Item: noName });

    const container = await repository.findById('container-1');

    expect(container!.name).toBe("Mike Ross's van");
  });

  it('carries extras through findByTechnicianId', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [importedRow] });

    const container = (await repository.findByTechnicianId('tech-1')) as unknown as Record<
      string,
      unknown
    >;

    expect(container.accessUserIds).toEqual(['user-4', 'user-9']);
    expect(container.SK).toBeUndefined();
  });

  it('create() writes the extras but always builds its own keys', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    const container = {
      ...createMockContainer({ id: 'container-1', technicianId: 'tech-1' }),
      externalId: 'workiz:location:8877',
      accessUserIds: ['user-4'],
      // A stale key the caller must never be able to force onto the row.
      GSI3PK: 'OWNER#someone-else',
    };

    await repository.create(container as any);

    const item = dynamoDb.client.send.mock.calls[0][0].input.Item;
    expect(item).toMatchObject({
      PK: 'CONTAINER#container-1',
      SK: 'METADATA',
      GSI3PK: 'OWNER#tech-1',
      GSI3SK: 'CONTAINER#container-1',
      externalId: 'workiz:location:8877',
      accessUserIds: ['user-4'],
    });
  });

  // Списки локацій читаються з індексу, не Scan-ом: без цих ключів фургон
  // просто не з'явиться в GET /containers.
  it('create() writes the location index keys', async () => {
    dynamoDb.client.send.mockResolvedValue({});

    await repository.create(
      createMockContainer({ id: 'container-1', name: '  (12) MIKE ' }),
    );

    const item = dynamoDb.client.send.mock.calls[0][0].input.Item;
    expect(item.GSI1PK).toBe('LOCATION#CONTAINER');
    expect(item.GSI1SK).toBe('(12) mike#container-1');
    expect(item.searchName).toBe('(12) mike');
  });

  it('update() rewrites the index sort key and the search name when the name changes', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Attributes: {
        ...importedRow,
        name: 'Van 2',
        GSI1SK: 'van 2#container-1',
        searchName: 'van 2',
      },
    });

    await repository.update('container-1', { name: 'Van 2' });

    expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.UpdateExpression).toContain('#GSI1SK = :GSI1SK');
    expect(input.UpdateExpression).toContain('#searchName = :searchName');
    expect(input.ExpressionAttributeValues[':GSI1SK']).toBe('van 2#container-1');
    expect(input.ExpressionAttributeValues[':GSI1PK']).toBe('LOCATION#CONTAINER');
    expect(input.ExpressionAttributeValues[':searchName']).toBe('van 2');
  });

  it('update() leaves the index keys alone when the name is not among the attrs and the row carries them', async () => {
    dynamoDb.client.send.mockResolvedValue({ Attributes: importedRow });

    await repository.update('container-1', { department: 'Marietta' });

    expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.UpdateExpression).not.toContain('GSI1');
  });

  // Рядок з main без ключів індексу: будь-яке редагування (переназначення
  // техніка, статус) повертає його у список, не лише перейменування.
  it('update() heals a row the list index does not hold, whatever field changed', async () => {
    const { GSI1PK: _pk, GSI1SK: _sk, searchName: _sn, ...unindexed } = importedRow;
    dynamoDb.client.send
      .mockResolvedValueOnce({ Attributes: { ...unindexed, technicianId: 'tech-9' } })
      .mockResolvedValueOnce({});

    const container = await repository.update('container-1', { technicianId: 'tech-9' });

    expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
    const heal = dynamoDb.client.send.mock.calls[1][0].input;
    expect(heal.Key).toEqual({ PK: 'CONTAINER#container-1', SK: 'METADATA' });
    expect(heal.UpdateExpression).toBe('SET GSI1PK = :pk, GSI1SK = :sk, searchName = :name');
    expect(heal.ExpressionAttributeValues).toEqual({
      ':pk': 'LOCATION#CONTAINER',
      ':sk': '(12) mike#container-1',
      ':name': '(12) mike',
    });
    expect(heal.ConditionExpression).toBe('attribute_exists(PK)');
    expect(container.technicianId).toBe('tech-9');
  });

  it('update() still rewrites the technician index on reassignment', async () => {
    dynamoDb.client.send.mockResolvedValue({ Attributes: importedRow });

    await repository.update('container-1', { technicianId: 'tech-9' });

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.ExpressionAttributeValues[':GSI3PK']).toBe('OWNER#tech-9');
    expect(input.ExpressionAttributeValues[':GSI3SK']).toBe('CONTAINER#container-1');
  });

  it('update() returns the extras it did not touch', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Attributes: { ...importedRow, department: 'Marietta' },
    });

    const container = (await repository.update('container-1', {
      department: 'Marietta',
    })) as unknown as Record<string, unknown>;

    expect(container.department).toBe('Marietta');
    expect(container.accessUserIds).toEqual(['user-4', 'user-9']);
  });

  it('reads the template the container is compared against', async () => {
    dynamoDb.client.send.mockResolvedValue({ Item: { ...importedRow, templateId: 'tpl-1' } });

    expect((await repository.findById('container-1'))!.templateId).toBe('tpl-1');
  });

  it('update() removes the template when it is cleared with null', async () => {
    dynamoDb.client.send.mockResolvedValue({ Attributes: importedRow });

    await repository.update('container-1', { templateId: null });

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.UpdateExpression).toMatch(/REMOVE .*#templateId/);
    expect(input.ExpressionAttributeValues).not.toHaveProperty(':templateId');
  });
});

describe('ContainersRepository.findAll', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: ContainersRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new ContainersRepository(dynamoDb as any);
  });

  const row = (id: string) => ({
    ...createMockContainer(),
    id,
    PK: `CONTAINER#${id}`,
    SK: 'METADATA',
    GSI1PK: 'LOCATION#CONTAINER',
    GSI1SK: `van 1#${id}`,
  });

  // Дев тримає ~45 тисяч рядків і ~90 локацій: фільтрований Scan вичерпував
  // бюджет читань до того, як сторінка наповнювалась, і кожна сторінка була
  // іншої довжини. Індекс віддає лише локації, впорядковані за назвою.
  it('queries the location index in name order instead of scanning the table', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [row('v1')] });

    await repository.findAll(20);

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(dynamoDb.client.send.mock.calls[0][0].constructor.name).toBe('QueryCommand');
    expect(input.IndexName).toBe('CategoryIndex');
    expect(input.KeyConditionExpression).toBe('GSI1PK = :pk');
    expect(input.ExpressionAttributeValues[':pk']).toBe('LOCATION#CONTAINER');
    expect(input.ScanIndexForward).toBe(true);
    expect(input.ExpressionAttributeNames).toBeUndefined();
  });

  // 119 з 207 контейнерів — заглушки Workiz ("Workiz location #6142 (видалено у
  // Workiz)"); Workiz показує ~88 справжніх фургонів. Лишаються доступними за id.
  it('leaves the Workiz placeholders out of the list, by filter rather than by index keys', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [] });

    await repository.findAll(20);

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.FilterExpression).toBe('(attribute_not_exists(placeholder) OR placeholder = :false)');
    expect(input.ExpressionAttributeValues).toEqual({ ':pk': 'LOCATION#CONTAINER', ':false': false });
  });

  // Термін шукається у назві, а не в ключі сортування: той несе UUID, і
  // "3" чи "de" збігалися б з id майже кожного фургона.
  it('filters by department, status and a trimmed, lowercased search term against the name alone', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [] });

    await repository.findAll(20, undefined, {
      department: 'Atlanta',
      status: InventoryStatus.ACTIVE,
      search: '  MiKe ',
    });

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.FilterExpression).toContain('#department = :dept');
    expect(input.FilterExpression).toContain('#status = :status');
    expect(input.FilterExpression).toContain('contains(searchName, :search)');
    expect(input.FilterExpression).not.toContain('GSI1SK');
    expect(input.ExpressionAttributeNames).toEqual({
      '#department': 'department',
      '#status': 'status',
    });
    expect(input.FilterExpression).toContain('(attribute_not_exists(placeholder) OR placeholder = :false)');
    expect(input.ExpressionAttributeValues).toEqual({
      ':pk': 'LOCATION#CONTAINER',
      ':false': false,
      ':dept': 'Atlanta',
      ':status': 'active',
      ':search': 'mike',
    });
  });

  // Те саме, що й у товарах: з фільтром `Limit` рахує прочитані рядки.
  it('fills the page across reads', async () => {
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [row('v1')], LastEvaluatedKey: { PK: 'X#1', SK: 'METADATA' } })
      .mockResolvedValueOnce({ Items: [row('v2')], LastEvaluatedKey: undefined });

    const result = await repository.findAll(3);

    expect(result.items.map((c) => c.id)).toEqual(['v1', 'v2']);
    expect(result.nextCursor).toBeUndefined();
  });

  // ExclusiveStartKey на GSI-запиті потребує і ключів таблиці, і ключів індексу.
  it('hands back a cursor with the index keys when a read overshoots the page', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Items: [row('v1'), row('v2'), row('v3')],
      LastEvaluatedKey: { PK: 'CONTAINER#v3', SK: 'METADATA', GSI1PK: 'LOCATION#CONTAINER', GSI1SK: 'van 1#v3' },
    });

    const result = await repository.findAll(2);

    expect(result.items.map((c) => c.id)).toEqual(['v1', 'v2']);
    expect(decodeCursor(result.nextCursor!)).toEqual({
      PK: 'CONTAINER#v2',
      SK: 'METADATA',
      GSI1PK: 'LOCATION#CONTAINER',
      GSI1SK: 'van 1#v2',
    });
  });

  it('resumes from the cursor it handed out', async () => {
    const key = { PK: 'CONTAINER#v2', SK: 'METADATA', GSI1PK: 'LOCATION#CONTAINER', GSI1SK: 'van 1#v2' };
    dynamoDb.client.send.mockResolvedValue({ Items: [row('v3')] });

    await repository.findAll(2, encodeCursor(key));

    expect(dynamoDb.client.send.mock.calls[0][0].input.ExclusiveStartKey).toEqual(key);
  });

  it('never leaks the index keys onto the entities', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [row('v1')] });

    const result = await repository.findAll(20);

    expect((result.items[0] as unknown as Record<string, unknown>).GSI1SK).toBeUndefined();
  });

  // Курсор зі Scan-версії списку (лише PK/SK) на Query по індексу дає
  // ValidationException і 500; клієнт з відкритою вкладкою через деплой
  // має отримати 400, а не падіння.
  it('rejects a cursor without the index keys with a 400 instead of asking DynamoDB', async () => {
    await expect(
      repository.findAll(2, encodeCursor({ PK: 'CONTAINER#v2', SK: 'METADATA' })),
    ).rejects.toThrow(BadRequestException);
    expect(dynamoDb.client.send).not.toHaveBeenCalled();
  });

  it('rejects a cursor that is not base64url JSON', async () => {
    await expect(repository.findAll(2, 'not-a-cursor')).rejects.toThrow(BadRequestException);
    expect(dynamoDb.client.send).not.toHaveBeenCalled();
  });

  describe('countAll', () => {
    it('counts the index partition without pulling item bodies back', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 12 });

      expect(await repository.countAll()).toEqual({ total: 12, atLeast: false });
      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.Select).toBe('COUNT');
      expect(input.IndexName).toBe('CategoryIndex');
      expect(input.KeyConditionExpression).toBe('GSI1PK = :pk');
      expect(input.ExpressionAttributeValues[':pk']).toBe('LOCATION#CONTAINER');
      expect(input.FilterExpression).toBe('(attribute_not_exists(placeholder) OR placeholder = :false)');
    });

    it('counts under the same department filter the list uses', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 3 });

      await repository.countAll({ department: 'locksmith' });

      const sent = dynamoDb.client.send.mock.calls[0][0];
      expect(sent.input.FilterExpression).toContain('#department = :dept');
      expect(sent.input.ExpressionAttributeValues[':dept']).toBe('locksmith');
    });

    it('counts under the same search and status filter the list uses', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 1 });

      await repository.countAll({ search: ' Mike', status: InventoryStatus.ARCHIVED });

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.FilterExpression).toContain('contains(searchName, :search)');
      expect(input.FilterExpression).toContain('#status = :status');
      expect(input.ExpressionAttributeValues[':search']).toBe('mike');
      expect(input.ExpressionAttributeValues[':status']).toBe('archived');
    });

    it('gives up on an exact answer rather than walk the whole table', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Count: 1,
        LastEvaluatedKey: { PK: 'X#1', SK: 'METADATA' },
      });

      expect((await repository.countAll()).atLeast).toBe(true);
    });
  });
});
