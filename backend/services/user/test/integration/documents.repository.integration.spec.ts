import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { DocumentsRepository } from '../../src/technicians/documents/documents.repository';
import { SensitiveRepository } from '../../src/technicians/documents/sensitive.repository';
import { AuditRepository } from '../../src/technicians/documents/audit.repository';
import { createTestTable, clearTestTable, getTestDynamoDbClient } from './setup';

jest.mock('../../src/technicians/constants/dynamo.constants', () => ({
  TECHNICIANS_TABLE: 'BitCRM_Users_Test',
  DOC_SK_PREFIX: 'DOC#',
  SENSITIVE_SK: 'TECH_SENSITIVE',
  auditPk: (u: string) => `AUDIT#${u}`,
}));

describe('Documents/Sensitive/Audit repositories (integration)', () => {
  let docs: DocumentsRepository;
  let sensitive: SensitiveRepository;
  let audit: AuditRepository;
  let db: ReturnType<typeof getTestDynamoDbClient>;

  beforeAll(async () => {
    await createTestTable();
    db = getTestDynamoDbClient();
    const mod = await Test.createTestingModule({
      providers: [
        DocumentsRepository,
        SensitiveRepository,
        AuditRepository,
        { provide: DynamoDbService, useValue: { client: db } },
      ],
    }).compile();
    docs = mod.get(DocumentsRepository);
    sensitive = mod.get(SensitiveRepository);
    audit = mod.get(AuditRepository);
  });

  afterAll(async () => clearTestTable());
  beforeEach(async () => clearTestTable());

  it('stores + reads + deletes document metadata', async () => {
    await docs.upsert({
      userId: 'tech-1',
      docType: 'drivers_license_front',
      s3Key: 'technicians/tech-1/drivers_license_front',
      contentType: 'image/jpeg',
      uploadedBy: 'tech-1',
      uploadedAt: '2026-06-30T00:00:00.000Z',
    });
    expect(await docs.getByType('tech-1', 'drivers_license_front')).toMatchObject({
      s3Key: 'technicians/tech-1/drivers_license_front',
    });
    expect(await docs.listByUser('tech-1')).toHaveLength(1);

    await docs.delete('tech-1', 'drivers_license_front');
    expect(await docs.getByType('tech-1', 'drivers_license_front')).toBeNull();
  });

  it('merge-writes encrypted sensitive fields independently', async () => {
    await sensitive.upsert('tech-1', { ssnEncrypted: 'ENC_SSN' });
    await sensitive.upsert('tech-1', { bankAccountEncrypted: 'ENC_BANK' });
    const got = await sensitive.get('tech-1');
    expect(got).toEqual({ ssnEncrypted: 'ENC_SSN', bankAccountEncrypted: 'ENC_BANK' });
  });

  it('appends audit entries and lists them newest-first', async () => {
    await audit.record({ userId: 'tech-1', actorId: 'a', action: 'sensitive.read', resource: 'ssn', timestamp: '2026-06-30T10:00:00.000Z' });
    await audit.record({ userId: 'tech-1', actorId: 'b', action: 'document.viewed', resource: 'profile_photo', timestamp: '2026-06-30T11:00:00.000Z' });
    const trail = await audit.listByUser('tech-1', 10);
    expect(trail).toHaveLength(2);
    expect(trail[0].action).toBe('document.viewed'); // newest first
  });
});
