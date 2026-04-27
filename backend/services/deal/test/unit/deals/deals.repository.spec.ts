import { DealStage, DealStatus } from '@bitcrm/types';
import { DealsRepository } from 'src/deals/deals.repository';
import { createMockDeal, createMockDynamoDbService } from '../mocks';

describe('DealsRepository', () => {
  let repository: DealsRepository;
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new DealsRepository(dynamoDb as any);
  });

  describe('create', () => {
    it('should send PutCommand with correct PK/SK and GSI keys', async () => {
      const deal = createMockDeal();
      dynamoDb.client.send.mockResolvedValue({});

      await repository.create(deal);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      const command = dynamoDb.client.send.mock.calls[0][0];
      const item = command.input.Item;
      expect(item.PK).toBe('DEAL#deal-1');
      expect(item.SK).toBe('METADATA');
      expect(item.GSI1PK).toBe('STAGE#new_lead');
      expect(item.GSI2PK).toBe('TECH#UNASSIGNED');
      expect(item.GSI3PK).toBe('CONTACT#contact-1');
      expect(item.GSI4PK).toBe('DISPATCHER#dispatcher-1');
    });

    it('should set GSI2PK to tech ID when assigned', async () => {
      const deal = createMockDeal({ assignedTechId: 'tech-1' });
      dynamoDb.client.send.mockResolvedValue({});

      await repository.create(deal);

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.Item.GSI2PK).toBe('TECH#tech-1');
    });

    it('should use createdAt for GSI2SK when no scheduledDate', async () => {
      const deal = createMockDeal({ scheduledDate: undefined });
      dynamoDb.client.send.mockResolvedValue({});

      await repository.create(deal);

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.Item.GSI2SK).toContain(deal.createdAt);
    });

    it('should set ConditionExpression', async () => {
      const deal = createMockDeal();
      dynamoDb.client.send.mockResolvedValue({});

      await repository.create(deal);

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.ConditionExpression).toBe('attribute_not_exists(PK)');
    });
  });

  describe('findById', () => {
    it('should return deal when found', async () => {
      const deal = createMockDeal();
      dynamoDb.client.send.mockResolvedValue({
        Item: { PK: 'DEAL#deal-1', SK: 'METADATA', ...deal },
      });

      const result = await repository.findById('deal-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('deal-1');
      expect(result!.stage).toBe(DealStage.NEW_LEAD);
    });

    it('should return null when not found', async () => {
      dynamoDb.client.send.mockResolvedValue({ Item: undefined });
      const result = await repository.findById('nonexistent');
      expect(result).toBeNull();
    });

    it('should map all fields correctly', async () => {
      const deal = createMockDeal({
        companyId: 'comp-1', scheduledTimeSlot: '09:00-12:00',
        source: 'Google', notes: 'Test', internalNotes: 'Internal',
        cancellationReason: undefined, estimatedTotal: 100, actualTotal: 90,
        paymentStatus: 'paid', sequenceNumber: 2,
      });
      dynamoDb.client.send.mockResolvedValue({ Item: { PK: 'DEAL#deal-1', SK: 'METADATA', ...deal } });

      const result = await repository.findById('deal-1');

      expect(result!.companyId).toBe('comp-1');
      expect(result!.scheduledTimeSlot).toBe('09:00-12:00');
      expect(result!.source).toBe('Google');
      expect(result!.estimatedTotal).toBe(100);
      expect(result!.paymentStatus).toBe('paid');
      expect(result!.sequenceNumber).toBe(2);
    });
  });

  describe('findByStage', () => {
    it('should query GSI1 with correct stage key', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [], Count: 0 });

      await repository.findByStage(DealStage.NEW_LEAD, 20);

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.IndexName).toBe('StageIndex');
      expect(command.input.ExpressionAttributeValues[':pk']).toBe('STAGE#new_lead');
      expect(command.input.ScanIndexForward).toBe(false);
    });

    it('should return mapped items with cursor', async () => {
      const deal = createMockDeal();
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...deal, PK: 'DEAL#deal-1', SK: 'METADATA' }],
        LastEvaluatedKey: { PK: 'x', SK: 'y' },
      });

      const result = await repository.findByStage(DealStage.NEW_LEAD, 20);

      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe('deal-1');
      expect(result.nextCursor).toBeDefined();
    });

    it('should pass decoded cursor as ExclusiveStartKey', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [] });
      const cursor = Buffer.from(JSON.stringify({ PK: 'x', SK: 'y' })).toString('base64url');

      await repository.findByStage(DealStage.NEW_LEAD, 10, cursor);

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.ExclusiveStartKey).toEqual({ PK: 'x', SK: 'y' });
      expect(command.input.Limit).toBe(10);
    });
  });

  describe('findByTech', () => {
    it('should query GSI2 with correct tech key', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [], Count: 0 });

      await repository.findByTech('tech-1', 20);

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.IndexName).toBe('TechIndex');
      expect(command.input.ExpressionAttributeValues[':pk']).toBe('TECH#tech-1');
    });

    it('should return mapped deal items', async () => {
      const deal = createMockDeal({ assignedTechId: 'tech-1' });
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...deal, PK: 'DEAL#deal-1', SK: 'METADATA' }],
      });

      const result = await repository.findByTech('tech-1', 20);
      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe('deal-1');
    });
  });

  describe('findByContact', () => {
    it('should query GSI3 with correct contact key', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [], Count: 0 });

      await repository.findByContact('contact-1', 20);

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.IndexName).toBe('ContactIndex');
      expect(command.input.ExpressionAttributeValues[':pk']).toBe('CONTACT#contact-1');
    });

    it('should return mapped deal items', async () => {
      const deal = createMockDeal();
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...deal, PK: 'DEAL#deal-1', SK: 'METADATA' }],
      });

      const result = await repository.findByContact('contact-1', 20);
      expect(result.items.length).toBe(1);
      expect(result.items[0].contactId).toBe('contact-1');
    });
  });

  describe('findByDispatcher', () => {
    it('should query GSI4 with correct dispatcher key', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [], Count: 0 });

      await repository.findByDispatcher('disp-1', 20);

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.IndexName).toBe('DispatcherIndex');
      expect(command.input.ExpressionAttributeValues[':pk']).toBe('DISPATCHER#disp-1');
    });

    it('should return items with cursor', async () => {
      const deal = createMockDeal();
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...deal, PK: 'DEAL#deal-1', SK: 'METADATA' }],
        LastEvaluatedKey: null,
      });

      const result = await repository.findByDispatcher('disp-1', 20);

      expect(result.items.length).toBe(1);
      expect(result.nextCursor).toBeUndefined();
    });
  });

  describe('findAll', () => {
    it('should scan with ACTIVE status filter by default', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [] });

      await repository.findAll(20);

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.FilterExpression).toContain('begins_with(PK, :pk)');
      expect(command.input.ExpressionAttributeValues[':status']).toBe(DealStatus.ACTIVE);
    });

    it('should return mapped deal items', async () => {
      const deal = createMockDeal();
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...deal, PK: 'DEAL#deal-1', SK: 'METADATA' }],
      });

      const result = await repository.findAll(20);
      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe('deal-1');
    });

    it('should use provided status filter', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [] });

      await repository.findAll(20, undefined, { status: DealStatus.DELETED });

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.ExpressionAttributeValues[':status']).toBe(DealStatus.DELETED);
    });

    it('should pass cursor', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [] });
      const cursor = Buffer.from(JSON.stringify({ PK: 'a' })).toString('base64url');

      await repository.findAll(10, cursor);

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.ExclusiveStartKey).toEqual({ PK: 'a' });
    });
  });

  describe('update', () => {
    it('should update GSI keys when stage changes', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...createMockDeal({ stage: DealStage.ASSIGNED }) },
      });

      await repository.update('deal-1', { stage: DealStage.ASSIGNED });

      const command = dynamoDb.client.send.mock.calls[0][0];
      const expr = command.input.UpdateExpression;
      expect(expr).toContain('#GSI1PK');
      expect(command.input.ExpressionAttributeValues[':GSI1PK']).toBe('STAGE#assigned');
    });

    it('should update GSI keys when tech changes', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...createMockDeal({ assignedTechId: 'tech-2' }) },
      });

      await repository.update('deal-1', { assignedTechId: 'tech-2' });

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.ExpressionAttributeValues[':GSI2PK']).toBe('TECH#tech-2');
    });

    it('should set TECH#UNASSIGNED when assignedTechId is empty', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...createMockDeal({ assignedTechId: '' }) },
      });

      await repository.update('deal-1', { assignedTechId: '' } as any);

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.ExpressionAttributeValues[':GSI2PK']).toBe('TECH#UNASSIGNED');
    });

    it('should update GSI2SK when scheduledDate changes', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...createMockDeal({ scheduledDate: '2026-05-01' }) },
      });

      await repository.update('deal-1', { scheduledDate: '2026-05-01' });

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.ExpressionAttributeValues[':GSI2SK']).toContain('2026-05-01');
    });

    it('should not update immutable fields', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...createMockDeal() },
      });

      await repository.update('deal-1', { id: 'hacked', createdBy: 'hacked', createdAt: 'hacked', dealNumber: 999, contactId: 'hacked' } as any);

      const command = dynamoDb.client.send.mock.calls[0][0];
      const expr = command.input.UpdateExpression;
      expect(expr).not.toContain('#id');
      expect(expr).not.toContain('#createdBy');
      expect(expr).not.toContain('#createdAt');
      expect(expr).not.toContain('#dealNumber');
      expect(expr).not.toContain('#contactId');
    });

    it('should have ConditionExpression for existence check', async () => {
      dynamoDb.client.send.mockResolvedValue({ Attributes: { ...createMockDeal() } });

      await repository.update('deal-1', { notes: 'x' });

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.ConditionExpression).toBe('attribute_exists(PK)');
      expect(command.input.ReturnValues).toBe('ALL_NEW');
    });
  });

  describe('softDelete', () => {
    it('should set status to deleted', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...createMockDeal({ status: DealStatus.DELETED }) },
      });

      await repository.softDelete('deal-1');

      const command = dynamoDb.client.send.mock.calls[0][0];
      const values = command.input.ExpressionAttributeValues;
      expect(values[':status']).toBe(DealStatus.DELETED);
    });
  });

  describe('getNextDealNumber', () => {
    it('should return incremented deal number', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { dealNumber: 1002 },
      });

      const result = await repository.getNextDealNumber();

      expect(result).toBe(1002);
      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.Key.PK).toBe('COUNTER');
      expect(command.input.Key.SK).toBe('DEAL_NUMBER');
      expect(command.input.ReturnValues).toBe('ALL_NEW');
    });
  });
});
