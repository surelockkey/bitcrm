import { DynamoDbService } from '@bitcrm/shared';
import type { AdminAuditEntry } from '@bitcrm/types';
import { AdminAuditRepository } from '../../../src/audit/admin-audit.repository';
import { createMockDynamoDbClient } from '../mocks';

const ENTRY: AdminAuditEntry = {
  id: 'a-1',
  at: '2026-10-15T09:48:03.040Z',
  action: 'user.deactivated',
  actorId: 'u-admin',
  actorEmail: 'admin@x.y',
  actorRoleId: 'role-admin',
  targetType: 'user',
  targetId: 'u-target',
  targetLabel: 'bob tech <bob@x.y>',
  traceId: 'eb532b07',
};

/**
 * The admin trail, in the users table — three copies of each entry, one
 * TransactWrite: the month's log, the subject's history, the actor's history.
 * None carries GSI keys; the users listing reads `USER#` rows only.
 */
describe('AdminAuditRepository', () => {
  let repo: AdminAuditRepository;
  let db: ReturnType<typeof createMockDynamoDbClient>;

  beforeEach(() => {
    db = createMockDynamoDbClient();
    repo = new AdminAuditRepository({ client: db } as unknown as DynamoDbService);
  });

  it('writes the entry under the month, the subject and the actor at once', async () => {
    db.send.mockResolvedValue({});
    await repo.record(ENTRY);

    const input = db.send.mock.calls[0][0].input;
    const items = input.TransactItems.map((t: { Put: { TableName: string; Item: Record<string, unknown> } }) => t.Put);
    expect(items.map((p: { TableName: string }) => p.TableName)).toEqual(['BitCRM_Users', 'BitCRM_Users', 'BitCRM_Users']);
    expect(items.map((p: { Item: Record<string, unknown> }) => [p.Item.PK, p.Item.SK])).toEqual([
      ['ADMINAUDIT#2026-10', '2026-10-15T09:48:03.040Z#a-1'],
      ['ADMINAUDIT#USER#u-target', '2026-10-15T09:48:03.040Z#a-1'],
      ['ADMINAUDIT#ACTOR#u-admin', '2026-10-15T09:48:03.040Z#a-1'],
    ]);
    for (const p of items) {
      expect(p.Item).toMatchObject(ENTRY);
      expect(Object.keys(p.Item).some((k) => k.startsWith('GSI'))).toBe(false);
    }
  });

  it('reads one partition newest first, without the keys, and hands back where it stopped', async () => {
    db.send.mockResolvedValue({
      Items: [{ PK: 'ADMINAUDIT#USER#u-target', SK: 's', ...ENTRY }],
      LastEvaluatedKey: { PK: 'ADMINAUDIT#USER#u-target', SK: 's' },
    });

    const page = await repo.page('ADMINAUDIT#USER#u-target', 25, { PK: 'x', SK: 'y' });

    const input = db.send.mock.calls[0][0].input;
    expect(input).toMatchObject({
      TableName: 'BitCRM_Users',
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'ADMINAUDIT#USER#u-target' },
      ScanIndexForward: false,
      Limit: 25,
      ExclusiveStartKey: { PK: 'x', SK: 'y' },
    });
    expect(page.items).toEqual([ENTRY]);
    expect(page.lastKey).toEqual({ PK: 'ADMINAUDIT#USER#u-target', SK: 's' });
  });
});
