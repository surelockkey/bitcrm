import { ContainersRepository } from 'src/containers/containers.repository';
import { createMockContainer, createMockDynamoDbService } from '../mocks';

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
  });

  // Те саме, що й у товарах: `Limit` рахує прочитані рядки спільної таблиці.
  it('fills the page across reads', async () => {
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [row('v1')], LastEvaluatedKey: { PK: 'X#1', SK: 'METADATA' } })
      .mockResolvedValueOnce({ Items: [row('v2')], LastEvaluatedKey: undefined });

    const result = await repository.findAll(3);

    expect(result.items.map((c) => c.id)).toEqual(['v1', 'v2']);
    expect(result.nextCursor).toBeUndefined();
  });
});

