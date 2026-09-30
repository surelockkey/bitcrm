import { UserContainerAccess, type UserContainer } from '@bitcrm/types';
import { UserContainersRepository } from 'src/user-containers/user-containers.repository';
import { userContainerItem } from 'src/user-containers/user-containers.constants';
import { INVENTORY_TABLE } from 'src/common/constants/dynamo.constants';
import { createMockDynamoDbService, createMockUserContainer } from '../mocks';

/**
 * Призначення фургонів (Workiz "User containers"): рядок на користувача, список
 * за іменем на GSI1 зі сталою партицією каталогу, і розріджений GSI3 — хто
 * працює з цим фургоном. Ключі GSI3 є лише при access = container.
 */
describe('userContainerItem', () => {
  it('keys a container assignment for the list (name order) and for its container', () => {
    const row = createMockUserContainer({ userId: 'tech-1', userName: ' Mike Ross ', containerId: 'c-1' });

    expect(userContainerItem(row)).toEqual({
      ...row,
      PK: 'USER_CONTAINER#tech-1',
      SK: 'METADATA',
      GSI1PK: 'CATALOG#USER_CONTAINER',
      GSI1SK: 'mike ross#tech-1',
      GSI3PK: 'CONTAINER_USERS#c-1',
      GSI3SK: 'USER#tech-1',
    });
  });

  it('gives "All locations" and "No access" no container keys', () => {
    for (const access of [UserContainerAccess.ALL, UserContainerAccess.NONE]) {
      const item = userContainerItem(
        createMockUserContainer({ access, containerId: undefined, containerName: undefined, limited: false }),
      );
      expect(item).not.toHaveProperty('GSI3PK');
      expect(item).not.toHaveProperty('GSI3SK');
      expect(item.GSI1PK).toBe('CATALOG#USER_CONTAINER');
    }
  });
});

describe('UserContainersRepository', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: UserContainersRepository;

  const stored = (row: UserContainer) => userContainerItem(row);

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send.mockResolvedValue({});
    repository = new UserContainersRepository(dynamoDb as any);
  });

  describe('put', () => {
    it('replaces the whole row, so the container keys go when the access is no longer a container', async () => {
      const row = createMockUserContainer({
        access: UserContainerAccess.NONE,
        containerId: undefined,
        containerName: undefined,
        limited: false,
      });

      await repository.put(row);

      const sent = dynamoDb.client.send.mock.calls[0][0];
      expect(sent.constructor.name).toBe('PutCommand');
      expect(sent.input.TableName).toBe(INVENTORY_TABLE);
      expect(sent.input.ConditionExpression).toBeUndefined();
      expect(sent.input.Item).toEqual(userContainerItem(row));
      expect(sent.input.Item).not.toHaveProperty('GSI3PK');
    });
  });

  describe('findByUser', () => {
    it('reads the user row by key and never leaks the key attributes', async () => {
      const row = createMockUserContainer();
      dynamoDb.client.send.mockResolvedValue({ Item: stored(row) });

      const found = await repository.findByUser('tech-1');

      expect(dynamoDb.client.send.mock.calls[0][0].input.Key).toEqual({
        PK: 'USER_CONTAINER#tech-1',
        SK: 'METADATA',
      });
      expect(found).toEqual(row);
    });

    it('answers null for a user with no row', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      expect(await repository.findByUser('nobody')).toBeNull();
    });
  });

  describe('listAll', () => {
    it('pages the catalog partition of GSI1 to the end, in name order', async () => {
      const a = createMockUserContainer({ userId: 'u-a', userName: 'Ann' });
      const b = createMockUserContainer({ userId: 'u-b', userName: 'Bob' });
      dynamoDb.client.send
        .mockResolvedValueOnce({ Items: [stored(a)], LastEvaluatedKey: { PK: 'x' } })
        .mockResolvedValueOnce({ Items: [stored(b)] });

      const rows = await repository.listAll();

      expect(rows).toEqual([a, b]);
      const [first, second] = dynamoDb.client.send.mock.calls.map((c) => c[0].input);
      expect(first).toMatchObject({
        IndexName: 'CategoryIndex',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': 'CATALOG#USER_CONTAINER' },
      });
      expect(first.ExclusiveStartKey).toBeUndefined();
      expect(second.ExclusiveStartKey).toEqual({ PK: 'x' });
    });
  });

  describe('listByContainer', () => {
    it('pages the container partition of GSI3 to the end', async () => {
      const a = createMockUserContainer({ userId: 'u-a', containerId: 'c-1' });
      const b = createMockUserContainer({ userId: 'u-b', containerId: 'c-1' });
      dynamoDb.client.send
        .mockResolvedValueOnce({ Items: [stored(a)], LastEvaluatedKey: { PK: 'y' } })
        .mockResolvedValueOnce({ Items: [stored(b)] });

      const rows = await repository.listByContainer('c-1');

      expect(rows).toEqual([a, b]);
      const [first, second] = dynamoDb.client.send.mock.calls.map((c) => c[0].input);
      expect(first).toMatchObject({
        IndexName: 'OwnerIndex',
        KeyConditionExpression: 'GSI3PK = :pk',
        ExpressionAttributeValues: { ':pk': 'CONTAINER_USERS#c-1' },
      });
      expect(second.ExclusiveStartKey).toEqual({ PK: 'y' });
    });
  });
});
