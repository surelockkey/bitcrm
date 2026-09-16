import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProductType } from '@bitcrm/types';
import { CreateProductDto } from 'src/products/dto/create-product.dto';
import { UpdateProductDto } from 'src/products/dto/update-product.dto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const errorsFor = async (cls: any, payload: unknown) =>
  (await validate(plainToInstance(cls, payload))).map((e) => e.property);

const valid = {
  name: 'Kwikset Deadbolt',
  sku: 'WZ-10707',
  category: 'Uncategorized',
  type: ProductType.PRODUCT,
  costCompany: 0,
  costTech: 0,
  priceClient: 0,
  serialTracking: false,
  minimumStockLevel: 0,
};

/**
 * The Workiz price book is full of zero-priced items (a "call for price"
 * placeholder) and of items with no category. Both have to survive the API,
 * not just a direct DynamoDB write.
 */
describe('CreateProductDto', () => {
  it('accepts a price / cost / minimum of exactly 0', async () => {
    expect(await errorsFor(CreateProductDto, valid)).toEqual([]);
  });

  it('accepts the "Uncategorized" sentinel like any other category name', async () => {
    expect(
      await errorsFor(CreateProductDto, { ...valid, category: 'Uncategorized' }),
    ).toEqual([]);
  });

  it('still rejects a negative price — importer rows go straight to DynamoDB', async () => {
    expect(await errorsFor(CreateProductDto, { ...valid, priceClient: -35 })).toEqual([
      'priceClient',
    ]);
  });

  it('still requires a category', async () => {
    const { category: _omitted, ...withoutCategory } = valid;
    expect(await errorsFor(CreateProductDto, withoutCategory)).toEqual(['category']);
  });
});

/**
 * Read-side tolerance: 15 832 imported items include 262 names over the web's
 * 120-char cap, 144 descriptions over 1 000 and 61 negative prices. Editing
 * one of those must not 400 on a field the request does not touch, so the
 * update DTO validates only the fields actually present in the body.
 */
describe('UpdateProductDto', () => {
  it('accepts a body carrying a single field', async () => {
    expect(await errorsFor(UpdateProductDto, { category: 'Locks' })).toEqual([]);
  });

  it('accepts an empty body (nothing changed)', async () => {
    expect(await errorsFor(UpdateProductDto, {})).toEqual([]);
  });

  it('does not require the fields the request leaves out', async () => {
    expect(await errorsFor(UpdateProductDto, { name: 'Renamed' })).toEqual([]);
  });

  it('still validates a field the request does change', async () => {
    expect(await errorsFor(UpdateProductDto, { priceClient: -1 })).toEqual([
      'priceClient',
    ]);
    expect(await errorsFor(UpdateProductDto, { type: 'other' })).toEqual(['type']);
  });
});
