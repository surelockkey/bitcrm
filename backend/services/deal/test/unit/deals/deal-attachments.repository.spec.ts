import { DealAttachmentsRepository } from 'src/deals/attachments/deal-attachments.repository';
import { createMockDynamoDbService } from '../mocks';

const jobFile = {
  dealId: 'd1',
  contactId: 'c1',
  id: 'att-1',
  fileName: 'before.jpg',
  contentType: 'image/jpeg',
  size: 2048,
  s3Key: 'deals/d1/attachments/att-1',
  uploadedBy: 'u1',
  uploadedAt: '2026-07-30T10:00:00.000Z',
};

const clientFile = {
  contactId: 'c1',
  id: 'att-9',
  fileName: 'contract.pdf',
  contentType: 'application/pdf',
  s3Key: 'contacts/c1/attachments/att-9',
  uploadedBy: 'u1',
  uploadedAt: '2026-07-31T10:00:00.000Z',
};

/**
 * Files live where their owner lives — a job's under DEAL#<id>, a client's own
 * under CONTACT#<id> — and both are filed in GSI10 under CONTACTFILE#<contactId>
 * so the client card lists them together, newest first.
 */
describe('DealAttachmentsRepository', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repo: DealAttachmentsRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send.mockResolvedValue({ Items: [] });
    repo = new DealAttachmentsRepository(dynamoDb as any);
  });

  it('a job file with a known contact is keyed in the contact index', async () => {
    await repo.create(jobFile);
    const item = dynamoDb.client.send.mock.calls[0][0].input.Item;
    expect(item).toMatchObject({
      PK: 'DEAL#d1',
      SK: 'ATTACH#att-1',
      GSI10PK: 'CONTACTFILE#c1',
      GSI10SK: '2026-07-30T10:00:00.000Z#att-1',
      contactId: 'c1',
    });
  });

  it('a job file whose contact is unknown gets no GSI10 keys (sparse)', async () => {
    const { contactId: _omit, ...noContact } = jobFile;
    await repo.create(noContact);
    const item = dynamoDb.client.send.mock.calls[0][0].input.Item;
    expect(item).not.toHaveProperty('GSI10PK');
    expect(item).not.toHaveProperty('contactId');
  });

  it('a client file lives under CONTACT#<id> / ATTACH#<id> and in the same index', async () => {
    await repo.createForContact(clientFile);
    const item = dynamoDb.client.send.mock.calls[0][0].input.Item;
    expect(item).toMatchObject({
      PK: 'CONTACT#c1',
      SK: 'ATTACH#att-9',
      GSI10PK: 'CONTACTFILE#c1',
      GSI10SK: '2026-07-31T10:00:00.000Z#att-9',
      contactId: 'c1',
    });
    expect(item).not.toHaveProperty('dealId');
  });

  it('getForContact / updateForContact / deleteForContact address the CONTACT# row', async () => {
    dynamoDb.client.send.mockResolvedValue({ Item: { PK: 'CONTACT#c1', SK: 'ATTACH#att-9', ...clientFile } });
    const got = await repo.getForContact('c1', 'att-9');
    expect(dynamoDb.client.send.mock.calls[0][0].input.Key).toEqual({ PK: 'CONTACT#c1', SK: 'ATTACH#att-9' });
    expect(got).toEqual(clientFile);

    dynamoDb.client.send.mockResolvedValue({ Attributes: { ...clientFile, fileName: 'signed.pdf' } });
    const updated = await repo.updateForContact('c1', 'att-9', { fileName: 'signed.pdf' });
    const upd = dynamoDb.client.send.mock.calls[1][0].input;
    expect(upd.Key).toEqual({ PK: 'CONTACT#c1', SK: 'ATTACH#att-9' });
    expect(upd.UpdateExpression).toBe('SET #fileName = :fileName');
    expect(updated.fileName).toBe('signed.pdf');

    await repo.deleteForContact('c1', 'att-9');
    expect(dynamoDb.client.send.mock.calls[2][0].input.Key).toEqual({ PK: 'CONTACT#c1', SK: 'ATTACH#att-9' });
  });

  it('listByContact queries ContactActivityIndex under CONTACTFILE#, newest first, paged', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Items: [
        { PK: 'CONTACT#c1', SK: 'ATTACH#att-9', GSI10PK: 'CONTACTFILE#c1', ...clientFile },
        { PK: 'DEAL#d1', SK: 'ATTACH#att-1', GSI10PK: 'CONTACTFILE#c1', ...jobFile },
      ],
      LastEvaluatedKey: { PK: 'DEAL#d1', SK: 'ATTACH#att-1', GSI10PK: 'CONTACTFILE#c1', GSI10SK: 'x' },
    });
    const page = await repo.listByContact('c1', 30);
    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.IndexName).toBe('ContactActivityIndex');
    expect(input.KeyConditionExpression).toBe('GSI10PK = :pk');
    expect(input.ExpressionAttributeValues).toEqual({ ':pk': 'CONTACTFILE#c1' });
    expect(input.ScanIndexForward).toBe(false);
    expect(input.Limit).toBe(30);
    expect(page.items.map((a) => a.id)).toEqual(['att-9', 'att-1']);
    // The job file keeps its dealId (that is how the web knows which download
    // route to call); the client file has none.
    const dealIdOf = (a: (typeof page.items)[number]) => ('dealId' in a ? a.dealId : undefined);
    expect(dealIdOf(page.items[1])).toBe('d1');
    expect(dealIdOf(page.items[0])).toBeUndefined();
    expect(page.nextCursor).toBeDefined();

    dynamoDb.client.send.mockResolvedValue({ Items: [] });
    await repo.listByContact('c1', 30, page.nextCursor);
    expect(dynamoDb.client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({
      PK: 'DEAL#d1',
      SK: 'ATTACH#att-1',
      GSI10PK: 'CONTACTFILE#c1',
      GSI10SK: 'x',
    });
  });
});
