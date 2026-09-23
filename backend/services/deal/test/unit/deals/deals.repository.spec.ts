import { DealStage, JobSuperStatus, DealStatus } from '@bitcrm/types';
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
      expect(item.GSI1PK).toBe('STATUS#submitted');
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

  describe('reassignContact', () => {
    it('should update contactId and re-point the GSI3 contact index key', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.reassignContact('deal-1', 'contact-new');

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.Key).toEqual({ PK: 'DEAL#deal-1', SK: 'METADATA' });
      expect(command.input.ConditionExpression).toBe('attribute_exists(PK)');
      expect(command.input.UpdateExpression).toContain('contactId');
      expect(command.input.UpdateExpression).toContain('GSI3PK');
      const values = Object.values(command.input.ExpressionAttributeValues ?? {});
      expect(values).toContain('contact-new');
      expect(values).toContain('CONTACT#contact-new');
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

    it('reads back the external company and the per-job client name', async () => {
      // toDeal() is a whitelist mapper: a field it forgets is written to
      // DynamoDB but stripped from every read path (API, indexer, UI).
      const deal = createMockDeal({
        externalCompanyId: 'extco-1',
        clientName: { firstName: 'Janet', lastName: 'Poole' },
      });
      dynamoDb.client.send.mockResolvedValue({
        Item: { PK: 'DEAL#deal-1', SK: 'METADATA', ...deal },
      });

      const result = await repository.findById('deal-1');

      expect(result!.externalCompanyId).toBe('extco-1');
      expect(result!.clientName).toEqual({ firstName: 'Janet', lastName: 'Poole' });
    });

    it('reads back the billing fields (tax snapshot, discount, itemCount, invoiceId)', async () => {
      const deal = createMockDeal({
        taxRateId: 'tax-1',
        taxRateName: 'GA',
        taxRatePercent: 7.25,
        taxSource: 'service_area',
        discount: { type: 'percent', value: 10 },
        itemCount: 3,
        invoiceId: 'deal-1',
      });
      dynamoDb.client.send.mockResolvedValue({ Item: { PK: 'DEAL#deal-1', SK: 'METADATA', ...deal } });

      const result = await repository.findById('deal-1');

      expect(result).toMatchObject({
        taxRateId: 'tax-1',
        taxRateName: 'GA',
        taxRatePercent: 7.25,
        taxSource: 'service_area',
        discount: { type: 'percent', value: 10 },
        itemCount: 3,
        invoiceId: 'deal-1',
      });
    });

    it('reads back the technician flow stamps — and their absence on older rows', async () => {
      // Same whitelist-mapper trap: a stamp toDeal() forgets is written and
      // then invisible to every read path.
      const stamped = createMockDeal({
        techConfirmedAt: '2026-09-16T09:00:00.000Z',
        techConfirmedBy: 'tech-1',
        arrivedAt: '2026-09-16T09:40:00.000Z',
        arrivedBy: 'tech-1',
        arrivedLocation: { lat: 41.76, lng: -72.67, accuracy: 12 },
      });
      dynamoDb.client.send.mockResolvedValue({
        Item: { PK: 'DEAL#deal-1', SK: 'METADATA', ...stamped },
      });

      const result = await repository.findById('deal-1');
      expect(result!.techConfirmedAt).toBe('2026-09-16T09:00:00.000Z');
      expect(result!.techConfirmedBy).toBe('tech-1');
      expect(result!.arrivedAt).toBe('2026-09-16T09:40:00.000Z');
      expect(result!.arrivedBy).toBe('tech-1');
      expect(result!.arrivedLocation).toEqual({ lat: 41.76, lng: -72.67, accuracy: 12 });

      // A row written before these fields existed reads as "not yet".
      dynamoDb.client.send.mockResolvedValue({
        Item: { PK: 'DEAL#deal-1', SK: 'METADATA', ...createMockDeal() },
      });
      const legacy = await repository.findById('deal-1');
      expect(legacy!.techConfirmedAt).toBeUndefined();
      expect(legacy!.arrivedAt).toBeUndefined();
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

  describe('findBySuperStatus', () => {
    it('should query GSI1 with correct super-status key', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [], Count: 0 });

      await repository.findBySuperStatus(JobSuperStatus.SUBMITTED, 20);

      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.IndexName).toBe('StageIndex');
      expect(command.input.ExpressionAttributeValues[':pk']).toBe('STATUS#submitted');
      expect(command.input.ScanIndexForward).toBe(false);
    });

    it('should return mapped items with cursor', async () => {
      const deal = createMockDeal();
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...deal, PK: 'DEAL#deal-1', SK: 'METADATA' }],
        LastEvaluatedKey: { PK: 'x', SK: 'y' },
      });

      const result = await repository.findBySuperStatus(JobSuperStatus.SUBMITTED, 20);

      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe('deal-1');
      expect(result.nextCursor).toBeDefined();
    });

    it('should pass decoded cursor as ExclusiveStartKey', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [] });
      const cursor = Buffer.from(JSON.stringify({ PK: 'x', SK: 'y' })).toString('base64url');

      await repository.findBySuperStatus(JobSuperStatus.SUBMITTED, 10, cursor);

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

    it('applies needsInvoice in memory to the batch-got deals', async () => {
      dynamoDb.client.send
        .mockResolvedValueOnce({ Items: [{ dealId: 'a' }, { dealId: 'b' }, { dealId: 'c' }] })
        .mockResolvedValueOnce({
          Responses: {
            [TABLE]: [
              createMockDeal({ id: 'a', itemCount: 2 }),
              createMockDeal({ id: 'b', itemCount: 2, invoiceId: 'b' }),
              createMockDeal({ id: 'c' }),
            ],
          },
        });

      const result = await repository.findByTech('tech-1', 20, undefined, { needsInvoice: true });
      expect(result.items.map((d) => d.id)).toEqual(['a']);
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

    it('getAssignment reads one row, confirmation included', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Item: { dealId: 'deal-1', techId: 'tech-1', assignedAt: 'a', techConfirmedAt: 'c' },
      });

      expect(await repository.getAssignment('deal-1', 'tech-1')).toEqual({
        dealId: 'deal-1',
        techId: 'tech-1',
        assignedAt: 'a',
        techConfirmedAt: 'c',
      });
      expect(dynamoDb.client.send.mock.calls[0][0].input.Key).toEqual({
        PK: 'DEAL#deal-1',
        SK: 'ASSIGN#tech-1',
      });
    });

    it('getAssignment answers null for a technician who is not on the job', async () => {
      dynamoDb.client.send.mockResolvedValue({});
      expect(await repository.getAssignment('deal-1', 'tech-9')).toBeNull();
    });

    it('confirmAssignment keeps the first stamp and needs the row to exist', async () => {
      dynamoDb.client.send.mockResolvedValue({});
      await repository.confirmAssignment('deal-1', 'tech-1', '2026-09-16T10:00:00.000Z');

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.Key).toEqual({ PK: 'DEAL#deal-1', SK: 'ASSIGN#tech-1' });
      expect(input.UpdateExpression).toContain('if_not_exists(techConfirmedAt, :at)');
      expect(input.ConditionExpression).toBe('attribute_exists(PK)');
    });

    it('confirmAssignment reports the stamp the row already had, so a repeat tap can stop', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { techConfirmedAt: '2026-09-16T09:00:00.000Z' },
      });

      const already = await repository.confirmAssignment('deal-1', 'tech-1', '2026-09-16T10:00:00.000Z');

      // ALL_OLD is what makes the write itself the arbiter of "who was first":
      // the loser of two simultaneous taps is handed the earlier stamp.
      expect(dynamoDb.client.send.mock.calls[0][0].input.ReturnValues).toBe('ALL_OLD');
      expect(already).toBe('2026-09-16T09:00:00.000Z');
    });

    it('confirmAssignment answers undefined when this call is the one that confirmed', async () => {
      dynamoDb.client.send.mockResolvedValue({ Attributes: { techId: 'tech-1' } });

      expect(
        await repository.confirmAssignment('deal-1', 'tech-1', '2026-09-16T10:00:00.000Z'),
      ).toBeUndefined();
    });

    it('restamping a moved date re-sorts the row without erasing what is on it', async () => {
      dynamoDb.client.send
        .mockResolvedValueOnce({ Items: [{ techId: 'tech-1' }] }) // listAssignmentTechIds
        .mockResolvedValue({});

      await repository.restampAssignmentDates('deal-1', '2026-06-02', 'disp-1');

      const input = dynamoDb.client.send.mock.calls[1][0].input;
      // An UpdateCommand (targeted SET), not a Put that would drop the
      // technician's confirmation along with the old sort key.
      expect(input.Item).toBeUndefined();
      expect(input.ExpressionAttributeValues[':gsi2sk']).toBe('2026-06-02#DEAL#deal-1');
      expect(input.UpdateExpression).toContain('GSI2SK = :gsi2sk');
      expect(input.UpdateExpression).not.toContain('techConfirmedAt');
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

    it('reads more rows than the page, because the table is mostly not deals', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [] });

      await repository.findAll(20);

      // A job's partition also holds its line items, assignments and history,
      // and the table holds every catalog besides. Asking DynamoDB for 50 rows
      // came back with one job.
      expect(dynamoDb.client.send.mock.calls[0][0].input.Limit).toBeGreaterThan(20);
    });

    it('keeps reading until the page is full', async () => {
      const row = (id: string) => ({ ...createMockDeal(), id, PK: `DEAL#${id}`, SK: 'METADATA' });
      dynamoDb.client.send
        .mockResolvedValueOnce({ Items: [row('d1')], LastEvaluatedKey: { PK: 'p1' } })
        .mockResolvedValueOnce({ Items: [row('d2')], LastEvaluatedKey: { PK: 'p2' } })
        .mockResolvedValueOnce({ Items: [row('d3')] });

      const result = await repository.findAll(3);

      expect(result.items.map((d) => d.id)).toEqual(['d1', 'd2', 'd3']);
      expect(result.nextCursor).toBeUndefined();
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

    it('filters to jobs needing an invoice (items, no invoice)', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [] });

      await repository.findAll(20, undefined, { needsInvoice: true });

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.FilterExpression).toContain('#itemCount > :zeroItems');
      expect(input.FilterExpression).toContain('attribute_not_exists(#invoiceId)');
      expect(input.ExpressionAttributeValues[':zeroItems']).toBe(0);
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
    it('should update GSI keys when super-status changes', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...createMockDeal({ superStatus: JobSuperStatus.IN_PROGRESS }) },
      });

      await repository.update('deal-1', { superStatus: JobSuperStatus.IN_PROGRESS });

      const command = dynamoDb.client.send.mock.calls[0][0];
      const expr = command.input.UpdateExpression;
      expect(expr).toContain('#GSI1PK');
      expect(command.input.ExpressionAttributeValues[':GSI1PK']).toBe('STATUS#in_progress');
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

    it('REMOVEs an attribute passed as null instead of SETting it (clears subStatusId)', async () => {
      dynamoDb.client.send.mockResolvedValue({ Attributes: { ...createMockDeal() } });

      await repository.update('deal-1', { subStatusId: null } as any);

      const command = dynamoDb.client.send.mock.calls[0][0];
      const expr = command.input.UpdateExpression as string;
      // Cleared via REMOVE, never SET — a SET to null would leave the attribute present.
      expect(expr).toContain('REMOVE #subStatusId');
      expect(expr).not.toContain('#subStatusId =');
      expect(command.input.ExpressionAttributeValues).not.toHaveProperty(':subStatusId');
      expect(command.input.ExpressionAttributeNames['#subStatusId']).toBe('subStatusId');
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

  describe('reserveDealNumber', () => {
    const conditionalFailure = () => {
      const err = new Error('The conditional request failed');
      err.name = 'ConditionalCheckFailedException';
      return err;
    };

    it('reserves a random 6-char code with an attribute_not_exists marker row', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      const code = await repository.reserveDealNumber();

      expect(code).toMatch(/^[A-Z0-9]{6}$/);
      expect(code).toMatch(/[A-Z]/);
      expect(code).toMatch(/[0-9]/);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
      const command = dynamoDb.client.send.mock.calls[0][0];
      expect(command.input.Item.PK).toBe(`DEALNUM#${code}`);
      expect(command.input.Item.SK).toBe('UNIQUE');
      expect(command.input.ConditionExpression).toBe('attribute_not_exists(PK)');
    });

    it('retries with a fresh code when the reservation collides', async () => {
      dynamoDb.client.send
        .mockRejectedValueOnce(conditionalFailure())
        .mockResolvedValueOnce({});

      const code = await repository.reserveDealNumber();

      expect(code).toMatch(/^[A-Z0-9]{6}$/);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
      const first = dynamoDb.client.send.mock.calls[0][0].input.Item.PK;
      const second = dynamoDb.client.send.mock.calls[1][0].input.Item.PK;
      expect(second).toBe(`DEALNUM#${code}`);
      expect(first).not.toBe(second);
    });

    it('gives up after exhausting retries on persistent collisions', async () => {
      dynamoDb.client.send.mockRejectedValue(conditionalFailure());

      await expect(repository.reserveDealNumber()).rejects.toThrow(/deal number/i);
      expect(dynamoDb.client.send.mock.calls.length).toBeGreaterThanOrEqual(5);
    });

    it('propagates non-collision errors immediately', async () => {
      dynamoDb.client.send.mockRejectedValue(new Error('network down'));

      await expect(repository.reserveDealNumber()).rejects.toThrow('network down');
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });
  });
});
