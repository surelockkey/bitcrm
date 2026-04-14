import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { RolesRepository } from '../../../src/roles/roles.repository';
import { createMockDynamoDbClient, createMockRole } from '../mocks';

describe('RolesRepository', () => {
  let repository: RolesRepository;
  let dbClient: ReturnType<typeof createMockDynamoDbClient>;

  beforeEach(async () => {
    dbClient = createMockDynamoDbClient();

    const module = await Test.createTestingModule({
      providers: [
        RolesRepository,
        { provide: DynamoDbService, useValue: { client: dbClient } },
      ],
    }).compile();

    repository = module.get(RolesRepository);
  });

  describe('create', () => {
    it('should send PutCommand with correct PK/SK/GSI keys', async () => {
      dbClient.send.mockResolvedValue({});
      const role = createMockRole({ id: 'role-1', name: 'Test Role' });

      await repository.create(role);

      expect(dbClient.send).toHaveBeenCalledTimes(1);
      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.TableName).toBe('BitCRM_Users');
      expect(input.Item.PK).toBe('ROLE#role-1');
      expect(input.Item.SK).toBe('METADATA');
      expect(input.Item.GSI1PK).toBe('ROLE_ENTITY');
      expect(input.Item.GSI1SK).toBe('ROLE#role-1');
    });
  });

  describe('findById', () => {
    it('should send GetCommand and return role', async () => {
      const role = createMockRole();
      dbClient.send.mockResolvedValue({
        Item: { PK: 'ROLE#role-1', SK: 'METADATA', ...role },
      });

      const result = await repository.findById('role-1');

      expect(result).toEqual(role);
      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.Key).toEqual({ PK: 'ROLE#role-1', SK: 'METADATA' });
    });

    it('should return null when not found', async () => {
      dbClient.send.mockResolvedValue({ Item: undefined });

      const result = await repository.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should query GSI1 with ROLE_ENTITY partition key', async () => {
      dbClient.send.mockResolvedValue({ Items: [] });

      await repository.findAll();

      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.IndexName).toBe('RoleIndex');
      expect(input.KeyConditionExpression).toBe('GSI1PK = :pk');
      expect(input.ExpressionAttributeValues[':pk']).toBe('ROLE_ENTITY');
    });

    it('should return mapped roles from Items', async () => {
      const role = createMockRole();
      dbClient.send.mockResolvedValue({
        Items: [{ PK: 'ROLE#role-1', SK: 'METADATA', GSI1PK: 'ROLE_ENTITY', ...role }],
      });

      const result = await repository.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('role-1');
    });
  });

  describe('findByName', () => {
    it('should scan with name filter', async () => {
      const role = createMockRole({ name: 'Admin' });
      dbClient.send.mockResolvedValue({
        Items: [{ PK: 'ROLE#role-1', SK: 'METADATA', ...role }],
      });

      const result = await repository.findByName('Admin');

      expect(result).toBeDefined();
      expect(result!.name).toBe('Admin');
      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.ExpressionAttributeValues[':name']).toBe('Admin');
    });

    it('should return null when no role matches name', async () => {
      dbClient.send.mockResolvedValue({ Items: [] });

      const result = await repository.findByName('Nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should send UpdateCommand with dynamic expression', async () => {
      const updated = createMockRole({ description: 'Updated' });
      dbClient.send.mockResolvedValue({ Attributes: { ...updated } });

      await repository.update('role-1', { description: 'Updated' });

      expect(dbClient.send).toHaveBeenCalledTimes(1);
      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.Key).toEqual({ PK: 'ROLE#role-1', SK: 'METADATA' });
      expect(input.UpdateExpression).toContain('#description = :description');
      expect(input.UpdateExpression).toContain('#updatedAt = :updatedAt');
      expect(input.ConditionExpression).toBe('attribute_exists(PK)');
    });
  });

  describe('delete', () => {
    it('should send DeleteCommand with correct key', async () => {
      dbClient.send.mockResolvedValue({});

      await repository.delete('role-1');

      expect(dbClient.send).toHaveBeenCalledTimes(1);
      const input = dbClient.send.mock.calls[0][0].input;
      expect(input.Key).toEqual({ PK: 'ROLE#role-1', SK: 'METADATA' });
    });
  });
});
