import { type CommissionConfig } from '@bitcrm/types';
import { CommissionRepository } from '../../../src/technicians/commission/commission.repository';
import { createMockDynamoDbClient } from '../mocks';

function cfg(o?: Partial<CommissionConfig>): CommissionConfig {
  return {
    userId: 'tech-1',
    baseRatePct: 40,
    creditCardFeePct: 3,
    achFeePct: 0,
    effectiveDate: '2026-01-01T00:00:00.000Z',
    createdBy: 'mgr-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...o,
  };
}

describe('CommissionRepository (unit)', () => {
  let client: ReturnType<typeof createMockDynamoDbClient>;
  let repo: CommissionRepository;

  beforeEach(() => {
    client = createMockDynamoDbClient();
    repo = new CommissionRepository({ client } as never);
  });

  it('create writes a versioned COMMISSION# item', async () => {
    client.send.mockResolvedValue({});
    await repo.create(cfg({ effectiveDate: '2026-05-01T00:00:00.000Z' }));
    const item = client.send.mock.calls[0][0].input.Item;
    expect(item.PK).toBe('USER#tech-1');
    expect(item.SK).toBe('COMMISSION#2026-05-01T00:00:00.000Z');
  });

  it('getLatest queries the COMMISSION# prefix descending, limit 1', async () => {
    client.send.mockResolvedValue({ Items: [cfg()] });
    const latest = await repo.getLatest('tech-1');
    const input = client.send.mock.calls[0][0].input;
    expect(input.KeyConditionExpression).toContain('begins_with(SK, :sk)');
    expect(input.ScanIndexForward).toBe(false);
    expect(input.Limit).toBe(1);
    expect(latest?.baseRatePct).toBe(40);
  });

  it('getLatest returns null when no config exists', async () => {
    client.send.mockResolvedValue({ Items: [] });
    expect(await repo.getLatest('tech-1')).toBeNull();
  });

  it('listHistory returns all versions descending', async () => {
    client.send.mockResolvedValue({ Items: [cfg(), cfg({ effectiveDate: '2025-01-01T00:00:00.000Z' })] });
    const history = await repo.listHistory('tech-1');
    const input = client.send.mock.calls[0][0].input;
    expect(input.ScanIndexForward).toBe(false);
    expect(history).toHaveLength(2);
  });
});
