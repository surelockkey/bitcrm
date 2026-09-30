/**
 * What a migrated job carries from Workiz and a person actually reads on
 * it (import plan A2): the second and third Workiz identifiers, the
 * service-address id, the job's own timezone and contact details, the
 * lead-conversion stamps, and the counters the card shows. Money stays out
 * until invoices are built; everything else the generator writes is stored
 * but deliberately unread.
 */
import { DealsRepository } from '../../../src/deals/deals.repository';
import { createMockDeal, createMockDynamoDbService } from '../mocks';

describe('toDeal — the Workiz fields a job carries over', () => {
  const stored = {
    ...createMockDeal({ id: 'd1' }),
    PK: 'DEAL#d1',
    SK: 'METADATA',
    externalId: 'workiz:job:862N5B',
    workizId: 4711,
    jobSerial: 372275,
    propId: 'prop-9',
    jobTimezone: 'America/New_York',
    converted: true,
    conversionDate: '2026-03-04T10:00:00.000Z',
    hasCalls: true,
    seen: true,
    filesCount: 12,
    lastSent: '2026-03-05T10:00:00.000Z',
    lastProgress: '2026-03-06T10:00:00.000Z',
    emailAddress: 'client@example.com',
    clientCompanyName: 'CBRE',
    phones: ['+14045551234', '+14045559999'],
    phoneExtensions: { '+14045551234': '102' },
    // Money — deliberately not read until invoices exist.
    jobTotalPrice: 345,
    taxAmount: 21,
  };

  let repository: DealsRepository;
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send.mockResolvedValue({ Item: stored });
  });

  it('reads every field the job card shows', async () => {
    const deal = await repository.findById('d1');
    expect(deal).toMatchObject({
      externalId: 'workiz:job:862N5B',
      workizId: 4711,
      jobSerial: 372275,
      propId: 'prop-9',
      jobTimezone: 'America/New_York',
      converted: true,
      conversionDate: '2026-03-04T10:00:00.000Z',
      hasCalls: true,
      seen: true,
      filesCount: 12,
      lastSent: '2026-03-05T10:00:00.000Z',
      lastProgress: '2026-03-06T10:00:00.000Z',
      emailAddress: 'client@example.com',
      clientCompanyName: 'CBRE',
      phones: ['+14045551234', '+14045559999'],
      phoneExtensions: { '+14045551234': '102' },
    });
  });

  it('leaves the money attributes alone — they are stored, not surfaced', async () => {
    const deal = (await repository.findById('d1')) as unknown as Record<string, unknown>;
    expect(deal.jobTotalPrice).toBeUndefined();
    expect(deal.taxAmount).toBeUndefined();
  });

  it('a job written by the app, carrying none of them, reads them as absent', async () => {
    dynamoDb.client.send.mockResolvedValue({ Item: { ...createMockDeal({ id: 'd2' }), PK: 'DEAL#d2', SK: 'METADATA' } });
    const deal = await repository.findById('d2');
    expect(deal?.externalId).toBeUndefined();
    expect(deal?.phones).toBeUndefined();
    expect(deal?.converted).toBeUndefined();
  });
});
