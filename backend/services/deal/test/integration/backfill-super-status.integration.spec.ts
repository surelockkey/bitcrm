import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  createTestTables,
  clearTestTable,
  getTestDynamoDbClient,
  DEALS_TEST_TABLE,
} from './setup';
import { backfillSuperStatus } from '../../src/scripts/backfill-super-status';

const TABLE = 'BitCRM_Deals_Test';

/** Insert a legacy deal row keyed by the old STAGE# GSI, with no superStatus. */
async function putLegacyDeal(id: string, stage: string) {
  await getTestDynamoDbClient().send(new PutCommand({
    TableName: TABLE,
    Item: { PK: `DEAL#${id}`, SK: 'METADATA', stage, GSI1PK: `STAGE#${stage}`, GSI1SK: `2026-01-01#DEAL#${id}` },
  }));
}

async function getDeal(id: string) {
  const res = await getTestDynamoDbClient().send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `DEAL#${id}`, SK: 'METADATA' },
  }));
  return res.Item;
}

describe('backfillSuperStatus (integration)', () => {
  const client = () => getTestDynamoDbClient();

  beforeAll(async () => createTestTables());
  afterAll(async () => clearTestTable(DEALS_TEST_TABLE));
  beforeEach(async () => clearTestTable(DEALS_TEST_TABLE));

  it('derives superStatus from the legacy stage and re-keys the GSI', async () => {
    await putLegacyDeal('a', 'assigned'); // → in_progress
    await putLegacyDeal('b', 'completed'); // → done
    await putLegacyDeal('c', 'canceled'); // → canceled

    const { migrated } = await backfillSuperStatus(client(), TABLE, {});

    expect(migrated).toBe(3);
    expect(await getDeal('a')).toMatchObject({ superStatus: 'in_progress', GSI1PK: 'STATUS#in_progress' });
    expect(await getDeal('b')).toMatchObject({ superStatus: 'done', GSI1PK: 'STATUS#done' });
    expect(await getDeal('c')).toMatchObject({ superStatus: 'canceled', GSI1PK: 'STATUS#canceled' });
  });

  it('is idempotent — a row already carrying superStatus is skipped', async () => {
    await putLegacyDeal('a', 'assigned');
    await backfillSuperStatus(client(), TABLE, {});

    const { migrated, skipped } = await backfillSuperStatus(client(), TABLE, {});
    expect(migrated).toBe(0);
    expect(skipped).toBe(1);
  });

  it('dry-run reports work without writing', async () => {
    await putLegacyDeal('a', 'new_lead');
    const { migrated } = await backfillSuperStatus(client(), TABLE, { dryRun: true });

    expect(migrated).toBe(1);
    expect(await getDeal('a')).not.toHaveProperty('superStatus');
  });
});
