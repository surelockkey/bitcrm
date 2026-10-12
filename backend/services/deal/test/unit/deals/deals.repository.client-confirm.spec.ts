import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DealsRepository } from 'src/deals/deals.repository';
import { createMockDynamoDbService } from '../mocks';

describe('DealsRepository — the client’s confirmation (B12)', () => {
  let repository: DealsRepository;
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new DealsRepository(dynamoDb as any);
  });

  it('stamps when, how, who and for which visit — on an existing job only', async () => {
    dynamoDb.client.send.mockResolvedValue({});

    const recorded = await repository.recordClientConfirmation('deal-1', {
      at: '2026-04-20T12:00:00.000Z',
      via: 'link',
      by: 'contact-1',
      visit: '2026-04-20 09:00-12:00',
    });

    expect(recorded).toBe(true);
    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Key).toEqual({ PK: 'DEAL#deal-1', SK: 'METADATA' });
    expect(input.UpdateExpression).toContain('clientConfirmedAt = :at');
    expect(input.UpdateExpression).toContain('clientConfirmedVia = :via');
    expect(input.UpdateExpression).toContain('clientConfirmedBy = :by');
    expect(input.UpdateExpression).toContain('clientConfirmedFor = :visit');
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':at': '2026-04-20T12:00:00.000Z',
      ':via': 'link',
      ':by': 'contact-1',
      ':visit': '2026-04-20 09:00-12:00',
    });
    // The write is the arbiter of "first": it only lands when this visit is not confirmed yet.
    expect(input.ConditionExpression).toContain('attribute_exists(PK)');
    expect(input.ConditionExpression).toContain('attribute_not_exists(clientConfirmedAt)');
    expect(input.ConditionExpression).toContain('clientConfirmedFor <> :visit');
  });

  it('confirms an unscheduled job without a visit, and lets a later date be confirmed again', async () => {
    dynamoDb.client.send.mockResolvedValue({});

    await repository.recordClientConfirmation('deal-1', { at: '2026-04-20T12:00:00.000Z', via: 'link', visit: '' });

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.UpdateExpression).toContain('REMOVE clientConfirmedFor');
    expect(input.UpdateExpression).not.toContain('clientConfirmedBy');
    expect(input.ExpressionAttributeValues).not.toHaveProperty(':visit');
    // Unscheduled: only a confirmation that was given for some date (now gone) may be replaced.
    expect(input.ConditionExpression).toContain('attribute_exists(clientConfirmedFor)');
  });

  it('answers false when the condition fails — the job was confirmed for this visit already (or vanished)', async () => {
    dynamoDb.client.send.mockRejectedValue(
      new ConditionalCheckFailedException({ message: 'The conditional request failed', $metadata: {} }),
    );
    await expect(
      repository.recordClientConfirmation('deal-1', { at: '2026-04-20T12:00:00.000Z', via: 'link', visit: 'x' }),
    ).resolves.toBe(false);
  });

  it('rethrows anything else', async () => {
    dynamoDb.client.send.mockRejectedValue(new Error('ProvisionedThroughputExceeded'));
    await expect(
      repository.recordClientConfirmation('deal-1', { at: '2026-04-20T12:00:00.000Z', via: 'link', visit: 'x' }),
    ).rejects.toThrow('ProvisionedThroughputExceeded');
  });

  it('reads the confirmation back onto the job', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Item: {
        PK: 'DEAL#deal-1',
        SK: 'METADATA',
        id: 'deal-1',
        dealNumber: 'AB12CD',
        contactId: 'contact-1',
        tagIds: [],
        assignedTechIds: [],
        clientConfirmedAt: '2026-04-20T12:00:00.000Z',
        clientConfirmedVia: 'link',
        clientConfirmedBy: 'contact-1',
        clientConfirmedFor: '2026-04-20 09:00-12:00',
      },
    });

    const deal = await repository.findById('deal-1');

    expect(deal).toMatchObject({
      clientConfirmedAt: '2026-04-20T12:00:00.000Z',
      clientConfirmedVia: 'link',
      clientConfirmedBy: 'contact-1',
      clientConfirmedFor: '2026-04-20 09:00-12:00',
    });
  });
});
