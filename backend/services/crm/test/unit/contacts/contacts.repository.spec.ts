import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { DynamoDbService } from '@bitcrm/shared';
import { ContactsRepository } from 'src/contacts/contacts.repository';
import { createMockContact, createMockDynamoDbService } from '../mocks';

describe('ContactsRepository', () => {
  let repository: ContactsRepository;
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;

  beforeEach(async () => {
    dynamoDb = createMockDynamoDbService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactsRepository,
        { provide: DynamoDbService, useValue: dynamoDb },
      ],
    }).compile();

    repository = module.get<ContactsRepository>(ContactsRepository);
  });

  describe('create', () => {
    it('should send TransactWriteCommand with contact and phone index items', async () => {
      const contact = createMockContact({ phones: ['+14045551234', '+15558675309'] });
      dynamoDb.client.send.mockResolvedValue({});

      await repository.create(contact);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      const command = dynamoDb.client.send.mock.calls[0][0];
      // 1 main contact + 2 phone index items = 3 transact items
      expect(command.input.TransactItems).toHaveLength(3);
    });

    it('should throw ConflictException on TransactionCanceledException', async () => {
      const contact = createMockContact();
      const error = new Error('Transaction cancelled');
      error.name = 'TransactionCanceledException';
      dynamoDb.client.send.mockRejectedValue(error);

      await expect(repository.create(contact)).rejects.toThrow(ConflictException);
    });

    it('should rethrow non-transaction errors', async () => {
      const contact = createMockContact();
      dynamoDb.client.send.mockRejectedValue(new Error('Network error'));

      await expect(repository.create(contact)).rejects.toThrow('Network error');
    });
  });

  describe('findById', () => {
    it('should return contact when found', async () => {
      const contact = createMockContact();
      dynamoDb.client.send.mockResolvedValue({
        Item: { ...contact, PK: `CONTACT#${contact.id}`, SK: 'METADATA' },
      });

      const result = await repository.findById('contact-1');

      expect(result).toBeDefined();
      expect(result!.id).toBe('contact-1');
      expect(result!.firstName).toBe('John');
    });

    it('should return null when not found', async () => {
      dynamoDb.client.send.mockResolvedValue({ Item: undefined });

      const result = await repository.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findByPhone', () => {
    it('should query phone index then get contact', async () => {
      const contact = createMockContact();
      dynamoDb.client.send
        .mockResolvedValueOnce({ Items: [{ contactId: 'contact-1' }] })
        .mockResolvedValueOnce({
          Item: { ...contact, PK: 'CONTACT#contact-1', SK: 'METADATA' },
        });

      const result = await repository.findByPhone('+14045551234');

      expect(result).toBeDefined();
      expect(result!.id).toBe('contact-1');
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
    });

    it('should return null if phone not found', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [] });

      const result = await repository.findByPhone('+19999999999');

      expect(result).toBeNull();
    });
  });

  describe('findByCompany', () => {
    it('should query GSI1 with company ID', async () => {
      const contact = createMockContact({ companyId: 'company-1' });
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...contact, PK: 'CONTACT#contact-1', SK: 'METADATA' }],
        LastEvaluatedKey: undefined,
      });

      const result = await repository.findByCompany('company-1', 20);

      expect(result.items).toHaveLength(1);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      const contact = createMockContact();
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...contact, PK: 'CONTACT#contact-1', SK: 'METADATA' }],
        LastEvaluatedKey: undefined,
      });

      const result = await repository.findAll(20);

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeUndefined();
    });

    it('should return nextCursor when there are more results', async () => {
      const contact = createMockContact();
      const lastKey = { PK: 'CONTACT#contact-1', SK: 'METADATA' };
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...contact, PK: 'CONTACT#contact-1', SK: 'METADATA' }],
        LastEvaluatedKey: lastKey,
      });

      const result = await repository.findAll(1);

      expect(result.nextCursor).toBeDefined();
    });
  });

  describe('update', () => {
    it('should build correct SET expression and return updated contact', async () => {
      const updated = createMockContact({ firstName: 'Jane' });
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...updated, PK: 'CONTACT#contact-1', SK: 'METADATA' },
      });

      const result = await repository.update('contact-1', { firstName: 'Jane' });

      expect(result.firstName).toBe('Jane');
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });

    it('should rebuild GSI1 keys when companyId changes', async () => {
      const updated = createMockContact({ companyId: 'company-2' });
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...updated, PK: 'CONTACT#contact-1', SK: 'METADATA' },
      });

      await repository.update('contact-1', { companyId: 'company-2' });

      const sendCall = dynamoDb.client.send.mock.calls[0][0];
      const input = sendCall.input;
      expect(JSON.stringify(input.ExpressionAttributeValues)).toContain('COMPANY#company-2');
    });

    it('should skip immutable keys (id, createdBy, createdAt)', async () => {
      const updated = createMockContact();
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...updated, PK: 'CONTACT#contact-1', SK: 'METADATA' },
      });

      await repository.update('contact-1', { id: 'new-id', createdBy: 'hacker', firstName: 'Jane' } as any);

      const sendCall = dynamoDb.client.send.mock.calls[0][0];
      const expressionNames = sendCall.input.ExpressionAttributeNames;
      expect(expressionNames).not.toHaveProperty('#id');
      expect(expressionNames).not.toHaveProperty('#createdBy');
    });
  });

  describe('updatePhoneIndex', () => {
    it('should delete old phone items and add new ones', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.updatePhoneIndex('contact-1', ['+14045551234'], ['+15558675309']);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      const command = dynamoDb.client.send.mock.calls[0][0];
      // 1 delete + 1 put = 2 transact items
      expect(command.input.TransactItems).toHaveLength(2);
    });

    it('should not send transaction when no changes', async () => {
      await repository.updatePhoneIndex('contact-1', [], []);

      expect(dynamoDb.client.send).not.toHaveBeenCalled();
    });
  });
});
