import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProductType } from '@bitcrm/types';
import { CreateProductDto } from 'src/products/dto/create-product.dto';
import { UpdateProductDto } from 'src/products/dto/update-product.dto';
import { ListProductsQueryDto } from 'src/products/dto/list-products-query.dto';

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

  // null очищає необов'язкове поле; обов'язкове поле null не приймає.
  it.each(['brandId', 'reorderLevel', 'supplier', 'barcode', 'description', 'taxable', 'manageStock'])(
    'lets null through for the optional field %s — it clears it',
    async (field) => {
      expect(await errorsFor(UpdateProductDto, { [field]: null })).toEqual([]);
    },
  );

  it.each([
    'name',
    'sku',
    'category',
    'type',
    'costCompany',
    'costTech',
    'priceClient',
    'serialTracking',
    'minimumStockLevel',
  ])('refuses null for the required field %s', async (field) => {
    expect(await errorsFor(UpdateProductDto, { [field]: null })).toEqual([field]);
  });
});

/**
 * Поля запасу з прайс-листа Workiz. ValidationPipe працює з whitelist:true —
 * поле без декоратора зрізається мовчки, тому ці три мусять бути оголошені;
 * а number і onHand навпаки — лишаються неоголошеними і не приймаються.
 */
describe('CreateProductDto — stock fields', () => {
  it('accepts manageStock, brandId and reorderLevel', async () => {
    expect(
      await errorsFor(CreateProductDto, {
        ...valid,
        manageStock: false,
        brandId: 'brand-1',
        reorderLevel: 3,
      }),
    ).toEqual([]);
  });

  it('rejects a negative or fractional reorderLevel', async () => {
    expect(await errorsFor(CreateProductDto, { ...valid, reorderLevel: -1 })).toEqual(['reorderLevel']);
    expect(await errorsFor(CreateProductDto, { ...valid, reorderLevel: 1.5 })).toEqual(['reorderLevel']);
  });

  it('rejects a manageStock that is not a boolean', async () => {
    expect(await errorsFor(CreateProductDto, { ...valid, manageStock: 'yes' })).toEqual(['manageStock']);
  });

  it('strips number and onHand under the whitelist — they are never taken from a client', async () => {
    const instance = plainToInstance(CreateProductDto, { ...valid, number: 5, onHand: 9 });
    await validate(instance, { whitelist: true });

    expect(instance).not.toHaveProperty('number');
    expect(instance).not.toHaveProperty('onHand');
  });

  it('lets the update DTO change the same three fields', async () => {
    expect(await errorsFor(UpdateProductDto, { manageStock: true, brandId: 'b', reorderLevel: 0 })).toEqual([]);
    expect(await errorsFor(UpdateProductDto, { reorderLevel: -2 })).toEqual(['reorderLevel']);
  });
});

/**
 * Query-параметри приходять рядками; `manageStock=true` мусить стати
 * булевим до IsBoolean, інакше фільтр 400-ить на кожен запит.
 */
describe('ListProductsQueryDto', () => {
  const build = (query: Record<string, unknown>) => plainToInstance(ListProductsQueryDto, query);

  it("reads 'true' and '1' as true", () => {
    expect(build({ manageStock: 'true' }).manageStock).toBe(true);
    expect(build({ manageStock: '1' }).manageStock).toBe(true);
  });

  it("reads 'false' and '0' as false", () => {
    expect(build({ manageStock: 'false' }).manageStock).toBe(false);
    expect(build({ manageStock: '0' }).manageStock).toBe(false);
  });

  it('leaves manageStock undefined when absent', async () => {
    const dto = build({ category: 'Locks' });
    expect(dto.manageStock).toBeUndefined();
    expect((await validate(dto)).map((e) => e.property)).toEqual([]);
  });

  it('rejects a manageStock it cannot read', async () => {
    expect(await errorsFor(ListProductsQueryDto, { manageStock: 'maybe' })).toEqual(['manageStock']);
  });

  it('accepts brandId next to the other filters', async () => {
    expect(
      await errorsFor(ListProductsQueryDto, {
        category: 'Locks',
        status: 'active',
        search: 'lock',
        brandId: 'brand-1',
        manageStock: 'true',
      }),
    ).toEqual([]);
  });
});
