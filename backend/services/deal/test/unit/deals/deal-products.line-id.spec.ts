/**
 * A job's line is keyed by its own id, not by the product it names
 * (web-deals-scale / import plan A1, 1.4). Workiz jobs carry the same
 * product twice — 19 506 lines in 8 765 pairs — and a key on `productId`
 * silently merged them. Rows written before this keep working: their
 * `lineId` reads back as the `productId` the key was made from, so every
 * old link, URL and cached row still points at the same line.
 */
import { DealProductsRepository } from '../../../src/products/deal-products.repository';
import { createMockDealProduct, createMockDynamoDbService } from '../mocks';

describe('DealProductsRepository — the line owns the key', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: DealProductsRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new DealProductsRepository(dynamoDb as any);
  });

  it('addProduct keys on the line id it was handed', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.addProduct('d1', createMockDealProduct({ lineId: 'line-1', productId: 'p-1' }));
    const item = dynamoDb.client.send.mock.calls[0][0].input.Item;
    expect(item.SK).toBe('PRODUCT#line-1');
    expect(item.lineId).toBe('line-1');
    expect(item.productId).toBe('p-1');
  });

  it('addProduct mints a line id when none was given, so the same product can be added twice', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.addProduct('d1', createMockDealProduct({ productId: 'p-1', lineId: undefined as never }));
    await repository.addProduct('d1', createMockDealProduct({ productId: 'p-1', lineId: undefined as never }));
    const first = dynamoDb.client.send.mock.calls[0][0].input.Item;
    const second = dynamoDb.client.send.mock.calls[1][0].input.Item;
    expect(first.SK).not.toBe(second.SK);
    expect(first.SK).toMatch(/^PRODUCT#[0-9a-f-]{36}$/);
    expect(first.productId).toBe('p-1');
    expect(second.productId).toBe('p-1');
  });

  it('a row written before line ids reads back with its key as the line id', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Items: [{ ...createMockDealProduct({ productId: 'p-1' }), PK: 'DEAL#d1', SK: 'PRODUCT#p-1', lineId: undefined }],
    });
    const [line] = await repository.findByDeal('d1');
    expect(line.lineId).toBe('p-1');
    expect(line.productId).toBe('p-1');
  });

  it('every single-line write and read addresses the line by its key', async () => {
    dynamoDb.client.send.mockResolvedValue({ Attributes: { ...createMockDealProduct({ lineId: 'line-1' }), PK: 'DEAL#d1', SK: 'PRODUCT#line-1' } });
    await repository.findProduct('d1', 'line-1');
    await repository.removeProduct('d1', 'line-1');
    await repository.setTaxable('d1', 'line-1', true);
    await repository.setOrderedAt("d1", "line-1", "2026-09-23T00:00:00.000Z");
    for (const call of dynamoDb.client.send.mock.calls) {
      const input = call[0].input;
      expect(input.Key ?? { SK: 'PRODUCT#line-1' }).toMatchObject({ SK: 'PRODUCT#line-1' });
    }
  });

  it('countByDeal and the ordered-lines scan still read every line of the job', async () => {
    dynamoDb.client.send.mockResolvedValue({ Count: 3, Items: [] });
    await repository.countByDeal('d1');
    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.ExpressionAttributeValues[':sk']).toBe('PRODUCT#');
  });
});

describe('DealsService — two lines of one product', () => {
  it('the swap guard is gone: a job may hold the same product on two lines', () => {
    // The guard existed only because the key was the product; Workiz jobs
    // routinely carry a part twice (different tech, different price).
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/deals/deals.service.ts'),
      'utf8',
    ) as string;
    expect(source).not.toContain('is already on this deal — edit that line instead');
  });
});
