import { type TechnicianProfile } from '@bitcrm/types';
import { TechniciansRepository } from '../../../src/technicians/technicians.repository';
import { createMockDynamoDbClient } from '../mocks';

function makeProfile(overrides?: Partial<TechnicianProfile>): TechnicianProfile {
  return {
    userId: 'tech-1',
    phone: '404-555-0123',
    callMaskingEnabled: false,
    gpsTrackingEnabled: false,
    mobileAppInstalled: false,
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('TechniciansRepository (unit)', () => {
  let client: ReturnType<typeof createMockDynamoDbClient>;
  let repo: TechniciansRepository;

  beforeEach(() => {
    client = createMockDynamoDbClient();
    repo = new TechniciansRepository({ client } as never);
  });

  describe('upsertProfile', () => {
    it('writes PK/SK and the TechnicianIndex GSI keys', async () => {
      client.send.mockResolvedValue({});
      await repo.upsertProfile(makeProfile({ userId: 'tech-1', status: 'pending' }));

      const item = client.send.mock.calls[0][0].input.Item;
      expect(item.PK).toBe('USER#tech-1');
      expect(item.SK).toBe('TECH_PROFILE');
      expect(item.GSI3PK).toBe('TECHNICIAN');
      expect(item.GSI3SK).toBe('pending#tech-1');
    });
  });

  describe('getProfile', () => {
    it('returns the mapped profile when present', async () => {
      client.send.mockResolvedValue({
        Item: { PK: 'USER#tech-1', SK: 'TECH_PROFILE', ...makeProfile() },
      });
      const result = await repo.getProfile('tech-1');
      expect(result).toMatchObject({ userId: 'tech-1', status: 'pending' });
      // internal keys are stripped
      expect((result as unknown as Record<string, unknown>).PK).toBeUndefined();
    });

    it('returns null when absent', async () => {
      client.send.mockResolvedValue({});
      expect(await repo.getProfile('nope')).toBeNull();
    });
  });

  describe('updateProfile', () => {
    it('rebuilds GSI3SK when status changes', async () => {
      client.send.mockResolvedValue({ Attributes: makeProfile({ status: 'active' }) });
      await repo.updateProfile('tech-1', { status: 'active' });

      const input = client.send.mock.calls[0][0].input;
      expect(input.ExpressionAttributeValues[':GSI3SK']).toBe('active#tech-1');
      expect(input.UpdateExpression).toContain('#GSI3SK = :GSI3SK');
      expect(input.ConditionExpression).toBe('attribute_exists(PK)');
    });

    it('does not touch GSI3SK when status is unchanged', async () => {
      client.send.mockResolvedValue({ Attributes: makeProfile({ phone: '111' }) });
      await repo.updateProfile('tech-1', { phone: '111' });

      const input = client.send.mock.calls[0][0].input;
      expect(input.UpdateExpression).not.toContain('GSI3SK');
    });
  });

  describe('listByStatus', () => {
    it('queries TechnicianIndex with a status prefix', async () => {
      client.send.mockResolvedValue({ Items: [makeProfile()], LastEvaluatedKey: undefined });
      const result = await repo.listByStatus('active', 20);

      const input = client.send.mock.calls[0][0].input;
      expect(input.IndexName).toBe('TechnicianIndex');
      expect(input.KeyConditionExpression).toContain('GSI3PK = :pk');
      expect(input.KeyConditionExpression).toContain('begins_with');
      expect(input.ExpressionAttributeValues[':pk']).toBe('TECHNICIAN');
      expect(input.ExpressionAttributeValues[':sk']).toBe('active#');
      expect(result.items).toHaveLength(1);
    });
  });

  describe('listAll', () => {
    it('queries TechnicianIndex by the constant partition and encodes the cursor', async () => {
      client.send.mockResolvedValue({
        Items: [makeProfile()],
        LastEvaluatedKey: { PK: 'USER#tech-1', SK: 'TECH_PROFILE' },
      });
      const result = await repo.listAll(20);

      const input = client.send.mock.calls[0][0].input;
      expect(input.IndexName).toBe('TechnicianIndex');
      expect(input.KeyConditionExpression).toBe('GSI3PK = :pk');
      expect(input.ExpressionAttributeValues[':pk']).toBe('TECHNICIAN');
      expect(result.nextCursor).toBeDefined();
    });
  });
});
