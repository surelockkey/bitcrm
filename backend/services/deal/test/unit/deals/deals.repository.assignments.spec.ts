import { DealsRepository } from 'src/deals/deals.repository';
import { createMockDeal, createMockDynamoDbService } from '../mocks';

/**
 * The `ASSIGN#<techId>` rows carry the Workiz per-technician "sent" / "seen"
 * stamps next to the roster membership. These lock the write shapes and the
 * one behavioural change they forced: a reschedule now UPDATEs the row in
 * place instead of re-Putting it, or every stamp would vanish.
 */
describe('DealsRepository — assignment sent / seen stamps', () => {
  let repository: DealsRepository;
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new DealsRepository(dynamoDb as any);
  });

  const command = (n: number) => dynamoDb.client.send.mock.calls[n][0];

  /** What Dynamo throws when `attribute_exists(PK)` no longer holds. */
  const rowGone = () => Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });

  it('restampAssignmentDates updates the keys in place, keeping sentAt / seenAt', async () => {
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [{ techId: 'tech-1' }, { techId: 'tech-2' }] })
      .mockResolvedValue({});

    await repository.restampAssignmentDates('deal-1', '2026-05-02', 'disp-1');

    expect(dynamoDb.client.send).toHaveBeenCalledTimes(3);
    for (const n of [1, 2]) {
      const cmd = command(n);
      expect(cmd.constructor.name).toBe('UpdateCommand');
      expect(cmd.input.Key.PK).toBe('DEAL#deal-1');
      expect(cmd.input.UpdateExpression).toBe('SET GSI2PK = :gsi2pk, GSI2SK = :gsi2sk, scheduledDate = :scheduledDate');
      expect(cmd.input.ExpressionAttributeValues).toMatchObject({ ':gsi2sk': '2026-05-02#DEAL#deal-1', ':scheduledDate': '2026-05-02' });
      expect(cmd.input.ConditionExpression).toBe('attribute_exists(PK)');
    }
    expect(command(1).input.Key.SK).toBe('ASSIGN#tech-1');
    expect(command(2).input.Key.SK).toBe('ASSIGN#tech-2');
  });

  // The Put this replaced rewrote GSI2PK on every reschedule, so a row that
  // lost it (or an import that never wrote it) came back on the tech index.
  it('restampAssignmentDates rewrites GSI2PK, repairing a row missing from the tech index', async () => {
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [{ techId: 'tech-1' }, { techId: 'tech-2' }] })
      .mockResolvedValue({});

    await repository.restampAssignmentDates('deal-1', '2026-05-02', 'disp-1');

    expect(command(1).input.ExpressionAttributeValues[':gsi2pk']).toBe('TECH#tech-1');
    expect(command(2).input.ExpressionAttributeValues[':gsi2pk']).toBe('TECH#tech-2');
  });

  it('restampAssignmentDates removes the date when the job becomes unscheduled', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({ Items: [{ techId: 'tech-1' }] }).mockResolvedValue({});

    await repository.restampAssignmentDates('deal-1', undefined, 'disp-1');

    const cmd = command(1);
    expect(cmd.input.UpdateExpression).toBe('SET GSI2PK = :gsi2pk, GSI2SK = :gsi2sk REMOVE scheduledDate');
    expect(cmd.input.ExpressionAttributeValues[':gsi2sk']).toMatch(/#DEAL#deal-1$/);
    expect(cmd.input.ExpressionAttributeValues[':gsi2pk']).toBe('TECH#tech-1');
    expect(cmd.input.ExpressionAttributeValues).not.toHaveProperty(':scheduledDate');
  });

  // A concurrent unassign between the roster read and the write: the row that
  // vanished is the one that no longer needs restamping. The Put this replaced
  // simply succeeded, so a reschedule must not start 500-ing over it.
  it('restampAssignmentDates skips a row deleted under it and still restamps the rest', async () => {
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [{ techId: 'tech-1' }, { techId: 'tech-2' }] })
      .mockRejectedValueOnce(rowGone())
      .mockResolvedValueOnce({});

    await expect(repository.restampAssignmentDates('deal-1', '2026-05-02', 'disp-1')).resolves.toBeUndefined();

    expect(command(2).input.Key.SK).toBe('ASSIGN#tech-2');
  });

  it('restampAssignmentDates still throws anything that is not a vanished row', async () => {
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [{ techId: 'tech-1' }] })
      .mockRejectedValueOnce(new Error('ProvisionedThroughputExceededException'));

    await expect(repository.restampAssignmentDates('deal-1', '2026-05-02', 'disp-1')).rejects.toThrow(
      'ProvisionedThroughputExceededException',
    );
  });

  it('markAssignmentsSent stamps each named row and drops the previous deliveries', async () => {
    dynamoDb.client.send.mockResolvedValue({});

    await repository.markAssignmentsSent('deal-1', ['tech-1', 'tech-2'], {
      sentAt: '2026-04-16T10:00:00.000Z', sentVia: ['sms', 'email'], sentBy: 'disp-1',
    });

    expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
    const cmd = command(0);
    expect(cmd.constructor.name).toBe('UpdateCommand');
    expect(cmd.input.Key).toEqual({ PK: 'DEAL#deal-1', SK: 'ASSIGN#tech-1' });
    expect(cmd.input.UpdateExpression).toBe('SET sentAt = :sentAt, sentVia = :sentVia, sentBy = :sentBy REMOVE deliveries');
    expect(cmd.input.ExpressionAttributeValues).toEqual({
      ':sentAt': '2026-04-16T10:00:00.000Z', ':sentVia': ['sms', 'email'], ':sentBy': 'disp-1',
    });
    expect(cmd.input.ConditionExpression).toBe('attribute_exists(PK)');
    expect(command(1).input.Key.SK).toBe('ASSIGN#tech-2');
  });

  // One roster entry whose row is missing (a concurrent unassign, a job the
  // assignment backfill never reached) used to reject the whole Promise.all,
  // 500-ing a send that the deal row had already been stamped for.
  it('markAssignmentsSent skips a technician whose row is gone and reports who was stamped', async () => {
    dynamoDb.client.send.mockRejectedValueOnce(rowGone()).mockResolvedValueOnce({});

    const stamped = await repository.markAssignmentsSent('deal-1', ['tech-1', 'tech-2'], {
      sentAt: '2026-04-16T10:00:00.000Z', sentVia: ['sms'], sentBy: 'disp-1',
    });

    expect(stamped).toEqual(['tech-2']);
    expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
  });

  it('markAssignmentsSent still throws anything that is not a vanished row', async () => {
    dynamoDb.client.send.mockRejectedValueOnce(new Error('ProvisionedThroughputExceededException'));

    await expect(
      repository.markAssignmentsSent('deal-1', ['tech-1'], {
        sentAt: '2026-04-16T10:00:00.000Z', sentVia: ['sms'], sentBy: 'disp-1',
      }),
    ).rejects.toThrow('ProvisionedThroughputExceededException');
  });

  it('markAssignmentSeen keeps the earliest time and reports what is stored', async () => {
    dynamoDb.client.send.mockResolvedValue({ Attributes: { seenAt: '2026-04-16T09:00:00.000Z' } });

    expect(await repository.markAssignmentSeen('deal-1', 'tech-1', '2026-04-16T10:00:00.000Z')).toBe('2026-04-16T09:00:00.000Z');

    const cmd = command(0);
    expect(cmd.input.UpdateExpression).toBe('SET seenAt = if_not_exists(seenAt, :seenAt)');
    expect(cmd.input.ExpressionAttributeValues).toEqual({ ':seenAt': '2026-04-16T10:00:00.000Z' });
    expect(cmd.input.ReturnValues).toBe('ALL_NEW');
    expect(cmd.input.ConditionExpression).toBe('attribute_exists(PK)');
  });

  it('recordAssignmentDelivery creates the map when missing, then sets the channel', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    const delivery = { status: 'skipped' as const, sentAt: '2026-04-16T10:00:00.000Z', at: '2026-04-16T10:00:03.000Z', reason: 'no_phone' };

    await repository.recordAssignmentDelivery('deal-1', 'tech-1', 'sms', delivery);

    expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
    expect(command(0).input.UpdateExpression).toBe('SET deliveries = if_not_exists(deliveries, :empty)');
    expect(command(0).input.ExpressionAttributeValues).toEqual({ ':empty': {} });
    const set = command(1);
    expect(set.input.UpdateExpression).toBe('SET deliveries.#channel = :delivery');
    expect(set.input.ExpressionAttributeNames).toEqual({ '#channel': 'sms' });
    expect(set.input.ExpressionAttributeValues).toEqual({ ':delivery': delivery });
    expect(set.input.Key).toEqual({ PK: 'DEAL#deal-1', SK: 'ASSIGN#tech-1' });
  });

  it('getAssignment / listAssignments read the rows back as entities (null when absent)', async () => {
    const row = {
      PK: 'DEAL#deal-1', SK: 'ASSIGN#tech-1', GSI2PK: 'TECH#tech-1', GSI2SK: '2026-05-01#DEAL#deal-1',
      dealId: 'deal-1', techId: 'tech-1', assignedBy: 'disp-1', assignedAt: '2026-04-16T09:00:00.000Z', scheduledDate: '2026-05-01',
      sentAt: '2026-04-16T10:00:00.000Z', sentVia: ['sms'], sentBy: 'disp-1', seenAt: '2026-04-16T10:05:00.000Z',
      deliveries: { sms: { status: 'sent', sentAt: '2026-04-16T10:00:00.000Z', at: '2026-04-16T10:00:02.000Z', messageId: 'm1' } },
    };
    dynamoDb.client.send.mockResolvedValueOnce({ Item: row }).mockResolvedValueOnce({ Item: undefined }).mockResolvedValueOnce({ Items: [row] });

    expect(await repository.getAssignment('deal-1', 'tech-1')).toEqual({
      dealId: 'deal-1', techId: 'tech-1', assignedBy: 'disp-1', assignedAt: '2026-04-16T09:00:00.000Z', scheduledDate: '2026-05-01',
      sentAt: '2026-04-16T10:00:00.000Z', sentVia: ['sms'], sentBy: 'disp-1', seenAt: '2026-04-16T10:05:00.000Z', deliveries: row.deliveries,
    });
    expect(command(0).input.Key).toEqual({ PK: 'DEAL#deal-1', SK: 'ASSIGN#tech-1' });
    expect(await repository.getAssignment('deal-1', 'tech-9')).toBeNull();
    expect((await repository.listAssignments('deal-1')).map((a) => a.techId)).toEqual(['tech-1']);
  });

  it('toDeal carries the sent / seen fields and leaves them absent on legacy rows', async () => {
    const deal = createMockDeal();
    dynamoDb.client.send.mockResolvedValueOnce({
      Item: { PK: 'DEAL#deal-1', SK: 'METADATA', ...deal, sentToTechAt: '2026-04-16T10:00:00.000Z', sentToTechVia: ['sms', 'in_app'], sentToTechBy: 'disp-1', seenByTechAt: '2026-04-16T10:05:00.000Z' },
    });
    expect(await repository.findById('deal-1')).toMatchObject({
      sentToTechAt: '2026-04-16T10:00:00.000Z', sentToTechVia: ['sms', 'in_app'], sentToTechBy: 'disp-1', seenByTechAt: '2026-04-16T10:05:00.000Z',
    });

    dynamoDb.client.send.mockResolvedValueOnce({ Item: { PK: 'DEAL#deal-1', SK: 'METADATA', ...deal } });
    const legacy = await repository.findById('deal-1');
    expect(legacy!.sentToTechAt).toBeUndefined();
    expect(legacy!.seenByTechAt).toBeUndefined();
  });
});
