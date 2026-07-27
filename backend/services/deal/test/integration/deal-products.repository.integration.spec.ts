import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import { type DealProduct } from '@bitcrm/types';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { DealProductsRepository } from '../../src/products/deal-products.repository';
import {
  createTestTables,
  clearTestTable,
  getTestDynamoDbClient,
  DEALS_TEST_TABLE,
} from './setup';

jest.mock('../../src/common/constants/dynamo.constants', () => ({
  DEALS_TABLE: 'BitCRM_Deals_Test',
  DEALS_GSI1_NAME: 'StageIndex',
  DEALS_GSI2_NAME: 'TechIndex',
  DEALS_GSI3_NAME: 'ContactIndex',
  DEALS_GSI4_NAME: 'DispatcherIndex',
}));

function makeLine(overrides: Partial<DealProduct> = {}): DealProduct {
  return {
    productId: 'p1',
    name: 'Deadbolt',
    sku: 'KW-001',
    quantity: 2,
    costCompany: 15,
    costForTech: 20,
    priceClient: 45,
    fulfillment: 'sourced',
    sourceTechId: 'tech-1',
    addedBy: 'admin-1',
    addedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('DealProductsRepository (integration)', () => {
  let repo: DealProductsRepository;
  let db: ReturnType<typeof getTestDynamoDbClient>;

  beforeAll(async () => {
    await createTestTables();
    db = getTestDynamoDbClient();
    const mod = await Test.createTestingModule({
      providers: [
        DealProductsRepository,
        { provide: DynamoDbService, useValue: { client: db } },
      ],
    }).compile();
    repo = mod.get(DealProductsRepository);
  });

  afterAll(async () => clearTestTable(DEALS_TEST_TABLE));
  beforeEach(async () => clearTestTable(DEALS_TEST_TABLE));

  it('round-trips fulfillment, sourceTechId and orderedAt', async () => {
    await repo.addProduct('deal-1', makeLine({ fulfillment: 'to_order', sourceTechId: undefined }));

    const line = await repo.findProduct('deal-1', 'p1');
    expect(line).toMatchObject({ fulfillment: 'to_order' });
    expect(line!.sourceTechId).toBeUndefined();

    await repo.setOrderedAt('deal-1', 'p1', '2026-07-27T00:00:00.000Z');
    const ordered = await repo.findProduct('deal-1', 'p1');
    expect(ordered!.orderedAt).toBe('2026-07-27T00:00:00.000Z');

    await repo.setOrderedAt('deal-1', 'p1', null);
    const cleared = await repo.findProduct('deal-1', 'p1');
    expect(cleared!.orderedAt).toBeUndefined();
  });

  it("defaults a legacy row (no fulfillment attribute) to 'sourced' on read", async () => {
    // Write a raw row omitting `fulfillment`, as pre-feature code did.
    await db.send(
      new PutCommand({
        TableName: DEALS_TEST_TABLE,
        Item: {
          PK: 'DEAL#deal-legacy',
          SK: 'PRODUCT#p-old',
          productId: 'p-old',
          name: 'Old part',
          sku: 'OLD-1',
          quantity: 1,
          costCompany: 1,
          costForTech: 2,
          priceClient: 3,
          sourceTechId: 'tech-9',
          addedBy: 'admin-1',
          addedAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    );

    const line = await repo.findProduct('deal-legacy', 'p-old');
    expect(line!.fulfillment).toBe('sourced');
    expect(line!.sourceTechId).toBe('tech-9');
  });

  it('listRowsMissingFulfillment finds only rows lacking the field', async () => {
    await repo.addProduct('deal-1', makeLine({ productId: 'has-it', fulfillment: 'sourced' }));
    await db.send(
      new PutCommand({
        TableName: DEALS_TEST_TABLE,
        Item: {
          PK: 'DEAL#deal-1',
          SK: 'PRODUCT#needs-it',
          productId: 'needs-it',
          name: 'Legacy',
          sku: 'LEG-1',
          quantity: 1,
          costCompany: 1,
          costForTech: 2,
          priceClient: 3,
          addedBy: 'admin-1',
          addedAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    );

    const rows = await repo.listRowsMissingFulfillment();
    expect(rows).toEqual([{ dealId: 'deal-1', productId: 'needs-it' }]);

    await repo.setFulfillment('deal-1', 'needs-it', 'sourced');
    expect(await repo.listRowsMissingFulfillment()).toEqual([]);
  });
});
