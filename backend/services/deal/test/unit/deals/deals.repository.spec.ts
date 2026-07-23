import { DealStage, DealStatus } from '@bitcrm/types';
import { DealsRepository } from 'src/deals/deals.repository';
import { createMockDeal, createMockDynamoDbService } from '../mocks';

const TABLE = process.env.DEALS_TABLE || 'BitCRM_Deals';

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
      // The tech index (GSI2) lives on ASSIGN# rows, not deal metadata.
      expect(item.GSI2PK).toBeUndefined();
      expect(item.GSI3PK).toBe('CONTACT#contact-1');
      expect(item.GSI4PK).toBe('DISPATCHER#dispatcher-1');
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
        sourceId: 'src-1', notes: 'Test', internalNotes: 'Internal',
        cancellationReason: undefined, estimatedTotal: 100, actualTotal: 90,
        paymentStatus: 'paid', assignedTechIds: ['tech-1', 'tech-2'], sequences: { 'tech-1': 2 },
      });
      dynamoDb.client.send.mockResolvedValue({ Item: { PK: 'DEAL#deal-1', SK: 'METADATA', ...deal } });

      const result = await repository.findById('deal-1');

      expect(result!.companyId).toBe('comp-1');
      expect(result!.scheduledTimeSlot).toBe('09:00-12:00');
      expect(result!.sourceId).toBe('src-1');
      expect(result!.estimatedTotal).toBe(100);
      expect(result!.paymentStatus).toBe('paid');
      expect(result!.assignedTechIds).toEqual(['tech-1', 'tech-2']);
      expect(result!.sequences).toEqual({ 'tech-1': 2 });
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
    it('queries GSI2 for the tech assignment rows', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [], Count: 0 });

      await repository.findByTech('tech-1', 20);

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.IndexName).toBe('TechIndex');
      expect(command.input.ExpressionAttributeValues[':pk']).toBe('TECH#tech-1');
    });

    it('batch-gets the deals referenced by the assignment rows', async () => {
      const deal = createMockDeal({ id: 'deal-1', assignedTechIds: ['tech-1'] });
      dynamoDb.client.send
        // GSI2 query → assignment rows carrying dealId
        .mockResolvedValueOnce({ Items: [{ dealId: 'deal-1', techId: 'tech-1' }] })
        // BatchGet → deal metadata
        .mockResolvedValueOnce({
          Responses: { [TABLE]: [{ ...deal, PK: 'DEAL#deal-1', SK: 'METADATA' }] },
        });

      const result = await repository.findByTech('tech-1', 20);

      expect(result.items.map((d) => d.id)).toEqual(['deal-1']);
      const batch = dynamoDb.client.send.mock.calls[1][0];
      expect(batch.input.RequestItems[TABLE].Keys).toEqual([{ PK: 'DEAL#deal-1', SK: 'METADATA' }]);
    });

    it('returns empty without a BatchGet when the tech has no assignments', async () => {
      dynamoDb.client.send.mockResolvedValueOnce({ Items: [] });
      const result = await repository.findByTech('tech-1', 20);
      expect(result.items).toEqual([]);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('assignment rows', () => {
    it('addAssignment writes an ASSIGN# row on the tech index', async () => {
      dynamoDb.client.send.mockResolvedValue({});
      await repository.addAssignment('deal-1', 'tech-1', '2026-05-01', 'disp-1');

      const item = dynamoDb.client.send.mock.calls[0][0].input.Item;
      expect(item.PK).toBe('DEAL#deal-1');
      expect(item.SK).toBe('ASSIGN#tech-1');
      expect(item.GSI2PK).toBe('TECH#tech-1');
      expect(item.GSI2SK).toContain('2026-05-01');
      expect(item.techId).toBe('tech-1');
    });

    it('removeAssignment deletes the ASSIGN# row', async () => {
      dynamoDb.client.send.mockResolvedValue({});
      await repository.removeAssignment('deal-1', 'tech-1');

      const key = dynamoDb.client.send.mock.calls[0][0].input.Key;
      expect(key).toEqual({ PK: 'DEAL#deal-1', SK: 'ASSIGN#tech-1' });
    });

    it('listAssignmentTechIds queries the ASSIGN# rows', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ techId: 'tech-1' }, { techId: 'tech-2' }],
      });
      expect(await repository.listAssignmentTechIds('deal-1')).toEqual(['tech-1', 'tech-2']);

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.ExpressionAttributeValues[':pk']).toBe('DEAL#deal-1');
      expect(input.ExpressionAttributeValues[':sk']).toBe('ASSIGN#');
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
      expect(command.input.ExpressionAttributeValues[':active']).toBe(DealStatus.ACTIVE);
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
      expect(command.input.ExpressionAttributeValues[':active']).toBe(DealStatus.DELETED);
    });

    it('appends secondary filters (equality + tag contains) to the scan', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [] });

      await repository.findAll(20, undefined, { jobTypeId: 'jobtype-1', tagIds: ['tag-1'] });

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.FilterExpression).toContain('#jobTypeId = :jobTypeId');
      expect(command.input.FilterExpression).toContain('contains(#tagIds, :tag0)');
      expect(command.input.ExpressionAttributeValues[':jobTypeId']).toBe('jobtype-1');
      expect(command.input.ExpressionAttributeValues[':tag0']).toBe('tag-1');
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

    it('writes assignedTechIds and sequences as plain attributes (no metadata GSI2)', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...createMockDeal({ assignedTechIds: ['tech-2'] }) },
      });

      await repository.update('deal-1', { assignedTechIds: ['tech-2'], sequences: { 'tech-2': 1 } });

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.UpdateExpression).toContain('#assignedTechIds');
      expect(command.input.UpdateExpression).toContain('#sequences');
      expect(command.input.ExpressionAttributeValues).not.toHaveProperty(':GSI2PK');
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
