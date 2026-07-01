import { DocumentsRepository } from '../../../src/technicians/documents/documents.repository';
import { SensitiveRepository } from '../../../src/technicians/documents/sensitive.repository';
import { createMockDynamoDbClient } from '../mocks';

describe('DocumentsRepository (unit)', () => {
  let client: ReturnType<typeof createMockDynamoDbClient>;
  let repo: DocumentsRepository;

  beforeEach(() => {
    client = createMockDynamoDbClient();
    repo = new DocumentsRepository({ client } as never);
  });

  it('upsert writes DOC#<docType> metadata', async () => {
    client.send.mockResolvedValue({});
    await repo.upsert({
      userId: 'tech-1',
      docType: 'drivers_license_front',
      s3Key: 'technicians/tech-1/drivers_license_front',
      contentType: 'image/jpeg',
      uploadedBy: 'tech-1',
      uploadedAt: '2026-06-30T00:00:00.000Z',
    });
    const item = client.send.mock.calls[0][0].input.Item;
    expect(item.PK).toBe('USER#tech-1');
    expect(item.SK).toBe('DOC#drivers_license_front');
  });

  it('getByType returns null when absent', async () => {
    client.send.mockResolvedValue({});
    expect(await repo.getByType('tech-1', 'profile_photo')).toBeNull();
  });

  it('delete removes the metadata item', async () => {
    client.send.mockResolvedValue({});
    await repo.delete('tech-1', 'bank_document');
    expect(client.send.mock.calls[0][0].input.Key).toEqual({
      PK: 'USER#tech-1',
      SK: 'DOC#bank_document',
    });
  });
});

describe('SensitiveRepository (unit)', () => {
  let client: ReturnType<typeof createMockDynamoDbClient>;
  let repo: SensitiveRepository;

  beforeEach(() => {
    client = createMockDynamoDbClient();
    repo = new SensitiveRepository({ client } as never);
  });

  it('upsert merges encrypted fields onto the TECH_SENSITIVE item', async () => {
    client.send.mockResolvedValue({ Attributes: {} });
    await repo.upsert('tech-1', { ssnEncrypted: 'ENC1' });
    const input = client.send.mock.calls[0][0].input;
    expect(input.Key).toEqual({ PK: 'USER#tech-1', SK: 'TECH_SENSITIVE' });
    expect(input.UpdateExpression).toContain('#ssnEncrypted = :ssnEncrypted');
  });

  it('get returns the stored ciphertext fields', async () => {
    client.send.mockResolvedValue({
      Item: { ssnEncrypted: 'ENC1', bankAccountEncrypted: 'ENC2' },
    });
    const out = await repo.get('tech-1');
    expect(out).toEqual({ ssnEncrypted: 'ENC1', bankAccountEncrypted: 'ENC2' });
  });

  it('get returns null when no sensitive item exists', async () => {
    client.send.mockResolvedValue({});
    expect(await repo.get('tech-1')).toBeNull();
  });
});
