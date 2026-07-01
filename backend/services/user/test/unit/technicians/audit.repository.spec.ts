import { AuditRepository } from '../../../src/technicians/documents/audit.repository';
import { createMockDynamoDbClient } from '../mocks';

describe('AuditRepository (unit)', () => {
  let client: ReturnType<typeof createMockDynamoDbClient>;
  let repo: AuditRepository;

  beforeEach(() => {
    client = createMockDynamoDbClient();
    repo = new AuditRepository({ client } as never);
  });

  it('record writes an append-only AUDIT# item keyed by timestamp', async () => {
    client.send.mockResolvedValue({});
    await repo.record({
      userId: 'tech-1',
      actorId: 'mgr-1',
      action: 'sensitive.read',
      resource: 'ssn',
      timestamp: '2026-06-30T10:00:00.000Z',
    });
    const item = client.send.mock.calls[0][0].input.Item;
    expect(item.PK).toBe('AUDIT#tech-1');
    expect(item.SK).toContain('2026-06-30T10:00:00.000Z#');
    expect(item.action).toBe('sensitive.read');
  });

  it('listByUser queries the audit partition newest-first', async () => {
    client.send.mockResolvedValue({ Items: [{ userId: 'tech-1', action: 'document.viewed' }] });
    const out = await repo.listByUser('tech-1', 50);
    const input = client.send.mock.calls[0][0].input;
    expect(input.KeyConditionExpression).toContain('PK = :pk');
    expect(input.ExpressionAttributeValues[':pk']).toBe('AUDIT#tech-1');
    expect(input.ScanIndexForward).toBe(false);
    expect(input.Limit).toBe(50);
    expect(out).toHaveLength(1);
  });
});
