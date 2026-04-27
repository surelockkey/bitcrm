import { Test, TestingModule } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { CompaniesRepository } from 'src/companies/companies.repository';
import { createMockCompany, createMockDynamoDbService } from '../mocks';

describe('CompaniesRepository', () => {
  let repository: CompaniesRepository;
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;

  beforeEach(async () => {
    dynamoDb = createMockDynamoDbService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompaniesRepository,
        { provide: DynamoDbService, useValue: dynamoDb },
      ],
    }).compile();

    repository = module.get<CompaniesRepository>(CompaniesRepository);
  });

  describe('create', () => {
    it('should send PutCommand with correct PK/SK and GSI keys', async () => {
      const company = createMockCompany();
      dynamoDb.client.send.mockResolvedValue({});

      await repository.create(company);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      const command = dynamoDb.client.send.mock.calls[0][0];
      const item = command.input.Item;
      expect(item.PK).toBe('COMPANY#company-1');
      expect(item.SK).toBe('METADATA');
      expect(item.GSI1PK).toBe('TYPE#commercial');
      expect(item.GSI1SK).toBe('COMPANY#company-1');
    });

    it('should throw on duplicate PK (conditional check failed)', async () => {
      const company = createMockCompany();
      const error = new Error('Conditional check failed');
      error.name = 'ConditionalCheckFailedException';
      dynamoDb.client.send.mockRejectedValue(error);

      await expect(repository.create(company)).rejects.toThrow();
    });
  });

  describe('findById', () => {
    it('should return company when found', async () => {
      const company = createMockCompany();
      dynamoDb.client.send.mockResolvedValue({
        Item: { ...company, PK: 'COMPANY#company-1', SK: 'METADATA' },
      });

      const result = await repository.findById('company-1');

      expect(result).toBeDefined();
      expect(result!.id).toBe('company-1');
      expect(result!.title).toBe('Acme Corp');
    });

    it('should return null when not found', async () => {
      dynamoDb.client.send.mockResolvedValue({ Item: undefined });

      const result = await repository.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findByClientType', () => {
    it('should query GSI1 with client type', async () => {
      const company = createMockCompany();
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...company, PK: 'COMPANY#company-1', SK: 'METADATA' }],
        LastEvaluatedKey: undefined,
      });

      const result = await repository.findByClientType('commercial', 20);

      expect(result.items).toHaveLength(1);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      const company = createMockCompany();
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...company, PK: 'COMPANY#company-1', SK: 'METADATA' }],
        LastEvaluatedKey: undefined,
      });

      const result = await repository.findAll(20);

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeUndefined();
    });

    it('should return nextCursor when more results exist', async () => {
      const company = createMockCompany();
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...company, PK: 'COMPANY#company-1', SK: 'METADATA' }],
        LastEvaluatedKey: { PK: 'COMPANY#company-1', SK: 'METADATA' },
      });

      const result = await repository.findAll(1);

      expect(result.nextCursor).toBeDefined();
    });
  });

  describe('update', () => {
    it('should build SET expression and return updated company', async () => {
      const updated = createMockCompany({ title: 'New Name' });
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...updated, PK: 'COMPANY#company-1', SK: 'METADATA' },
      });

      const result = await repository.update('company-1', { title: 'New Name' });

      expect(result.title).toBe('New Name');
    });

    it('should rebuild GSI1 keys when clientType changes', async () => {
      const updated = createMockCompany({ clientType: 'government' as any });
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...updated, PK: 'COMPANY#company-1', SK: 'METADATA' },
      });

      await repository.update('company-1', { clientType: 'government' as any });

      const sendCall = dynamoDb.client.send.mock.calls[0][0];
      expect(JSON.stringify(sendCall.input.ExpressionAttributeValues)).toContain('TYPE#government');
    });

    it('should skip immutable keys (id, createdBy, createdAt)', async () => {
      const updated = createMockCompany();
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...updated, PK: 'COMPANY#company-1', SK: 'METADATA' },
      });

      await repository.update('company-1', { id: 'new-id', createdBy: 'x', title: 'New' } as any);

      const sendCall = dynamoDb.client.send.mock.calls[0][0];
      const names = sendCall.input.ExpressionAttributeNames;
      expect(names).not.toHaveProperty('#id');
      expect(names).not.toHaveProperty('#createdBy');
    });
  });
});
