import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddDealProductDto } from 'src/deals/dto/add-deal-product.dto';

const errorsFor = async (payload: unknown) =>
  (await validate(plainToInstance(AddDealProductDto, payload))).map((e) => e.property);

const line = {
  productId: 'product-1',
  name: 'Kwikset Deadbolt',
  sku: 'KW-001',
  quantity: 1,
  costCompany: 15,
  costForTech: 20,
  priceClient: 45,
};

describe('AddDealProductDto', () => {
  it('accepts the three fulfillments the API writes', async () => {
    for (const fulfillment of ['sourced', 'to_order', 'service']) {
      expect(await errorsFor({ ...line, fulfillment })).toEqual([]);
    }
  });

  it('accepts a line with no fulfillment (defaults to sourced)', async () => {
    expect(await errorsFor(line)).toEqual([]);
  });

  it("rejects 'imported' — only the Workiz importer writes that marker", async () => {
    // An imported line never moved BitCRM stock; letting the API mint one
    // would create a line that removal silently refuses to restore.
    expect(await errorsFor({ ...line, fulfillment: 'imported' })).toEqual([
      'fulfillment',
    ]);
  });

  it('accepts a client price of 0 — the price book is full of them', async () => {
    expect(await errorsFor({ ...line, priceClient: 0 })).toEqual([]);
  });
});
