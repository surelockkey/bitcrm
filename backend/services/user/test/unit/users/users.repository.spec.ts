import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { UserStatus } from '@bitcrm/types';
import { UsersRepository } from '../../../src/users/users.repository';
import { createMockDynamoDbClient, createMockUser } from '../mocks';

describe('UsersRepository', () => {
  let repository: UsersRepository;
  let dbClient: ReturnType<typeof createMockDynamoDbClient>;

  beforeEach(async () => {
    dbClient = createMockDynamoDbClient();

    const module = await Test.createTestingModule({
      providers: [
        UsersRepository,
        { provide: DynamoDbService, useValue: { client: dbClient } },
      ],
    }).compile();

    repository = module.get(UsersRepository);
  });

  describe('create', () => {
    it('should send PutCommand with correct keys and ConditionExpression', async () => {
      dbClient.send.mockResolvedValue({});
      const user = createMockUser();

      await repository.create(user);

      expect(dbClient.send).toHaveBeenCalledTimes(1);
      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.TableName).toBe('BitCRM_Users');
      expect(input.Item.PK).toBe('USER#user-1');
      expect(input.Item.SK).toBe('METADATA');
      expect(input.Item.GSI1PK).toBe('ROLE_USER#role-technician');
      expect(input.Item.GSI1SK).toBe('USER#user-1');
      expect(input.Item.GSI2PK).toBe('DEPT#HVAC');
      expect(input.Item.GSI2SK).toBe('USER#user-1');
      expect(input.ConditionExpression).toBe('attribute_not_exists(PK)');
    });
  });

  describe('findById', () => {
    it('should return mapped user when item exists', async () => {
      const user = createMockUser();
      dbClient.send.mockResolvedValue({
        Item: { PK: 'USER#user-1', SK: 'METADATA', ...user },
      });

      const result = await repository.findById('user-1');

      expect(result).toEqual(user);
      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.Key).toEqual({ PK: 'USER#user-1', SK: 'METADATA' });
    });

    it('should return null when item does not exist', async () => {
      dbClient.send.mockResolvedValue({ Item: undefined });

      const result = await repository.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findByRole', () => {
    it('should query GSI1 with correct key expression', async () => {
      dbClient.send.mockResolvedValue({ Items: [], LastEvaluatedKey: undefined });

      await repository.findByRole('admin', 10);

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.IndexName).toBe('RoleIndex');
      expect(input.KeyConditionExpression).toBe('GSI1PK = :pk');
      expect(input.ExpressionAttributeValues[':pk']).toBe('ROLE_USER#admin');
      expect(input.Limit).toBe(10);
    });

    it('should return items and nextCursor when paginated', async () => {
      const user = createMockUser();
      const lastKey = { PK: 'USER#user-1', SK: 'METADATA' };
      dbClient.send.mockResolvedValue({
        Items: [{ ...user, PK: 'USER#user-1', SK: 'METADATA' }],
        LastEvaluatedKey: lastKey,
      });

      const result = await repository.findByRole('technician', 10);

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeDefined();
      // Verify cursor is valid base64url
      const decoded = JSON.parse(
        Buffer.from(result.nextCursor!, 'base64url').toString('utf-8'),
      );
      expect(decoded).toEqual(lastKey);
    });

    it('should return undefined nextCursor on last page', async () => {
      dbClient.send.mockResolvedValue({
        Items: [],
        LastEvaluatedKey: undefined,
      });

      const result = await repository.findByRole('admin', 10);

      expect(result.nextCursor).toBeUndefined();
    });

    it('should decode and pass cursor as ExclusiveStartKey', async () => {
      dbClient.send.mockResolvedValue({ Items: [] });
      const startKey = { PK: 'USER#user-5', SK: 'METADATA' };
      const cursor = Buffer.from(JSON.stringify(startKey)).toString('base64url');

      await repository.findByRole('admin', 10, cursor);

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.ExclusiveStartKey).toEqual(startKey);
    });
  });

  describe('findByDepartment', () => {
    it('should query GSI2 with correct key', async () => {
      dbClient.send.mockResolvedValue({ Items: [] });

      await repository.findByDepartment('HVAC', 10);

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.IndexName).toBe('DepartmentIndex');
      expect(input.ExpressionAttributeValues[':pk']).toBe('DEPT#HVAC');
    });
  });

  describe('findAll', () => {
    it('should scan with begins_with filter', async () => {
      dbClient.send.mockResolvedValue({ Items: [] });

      await repository.findAll(20);

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.FilterExpression).toContain('begins_with(PK, :pk)');
      expect(input.ExpressionAttributeValues[':pk']).toBe('USER#');
      expect(input.Limit).toBe(20);
    });
  });

  describe('findByStatus', () => {
    it('should scan with status filter and ExpressionAttributeNames', async () => {
      dbClient.send.mockResolvedValue({ Items: [] });

      await repository.findByStatus(UserStatus.ACTIVE, 10);

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.ExpressionAttributeNames['#status']).toBe('status');
      expect(input.ExpressionAttributeValues[':status']).toBe('active');
    });
  });

  describe('update', () => {
    it('should build dynamic UpdateExpression and always include updatedAt', async () => {
      const updated = createMockUser({ firstName: 'Updated' });
      dbClient.send.mockResolvedValue({ Attributes: { ...updated } });

      await repository.update('user-1', { firstName: 'Updated' });

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.UpdateExpression).toContain('#firstName = :firstName');
      expect(input.UpdateExpression).toContain('#updatedAt = :updatedAt');
      expect(input.ExpressionAttributeNames['#firstName']).toBe('firstName');
      expect(input.ExpressionAttributeValues[':firstName']).toBe('Updated');
      expect(input.ConditionExpression).toBe('attribute_exists(PK)');
    });

    it('should skip id, cognitoSub, and email from expression', async () => {
      dbClient.send.mockResolvedValue({ Attributes: createMockUser() });

      await repository.update('user-1', {
        id: 'should-be-ignored',
        cognitoSub: 'should-be-ignored',
        email: 'should-be-ignored',
        firstName: 'Valid',
      } as never);

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.UpdateExpression).not.toContain('#id');
      expect(input.UpdateExpression).not.toContain('#cognitoSub');
      expect(input.UpdateExpression).not.toContain('#email');
      expect(input.UpdateExpression).toContain('#firstName');
    });

    it('should rebuild GSI1 keys when roleId changes', async () => {
      dbClient.send.mockResolvedValue({
        Attributes: createMockUser({ roleId: 'role-dispatcher' }),
      });

      await repository.update('user-1', { roleId: 'role-dispatcher' });

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.UpdateExpression).toContain('#GSI1PK');
      expect(input.ExpressionAttributeValues[':GSI1PK']).toBe(
        'ROLE_USER#role-dispatcher',
      );
      expect(input.ExpressionAttributeValues[':GSI1SK']).toBe('USER#user-1');
    });

    it('should rebuild GSI2 keys when department changes', async () => {
      dbClient.send.mockResolvedValue({
        Attributes: createMockUser({ department: 'Plumbing' }),
      });

      await repository.update('user-1', { department: 'Plumbing' });

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.UpdateExpression).toContain('#GSI2PK');
      expect(input.ExpressionAttributeValues[':GSI2PK']).toBe('DEPT#Plumbing');
    });

    it('should omit GSI keys when role and department unchanged', async () => {
      dbClient.send.mockResolvedValue({ Attributes: createMockUser() });

      await repository.update('user-1', { firstName: 'Updated' });

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.UpdateExpression).not.toContain('GSI1PK');
      expect(input.UpdateExpression).not.toContain('GSI2PK');
    });
  });
});
