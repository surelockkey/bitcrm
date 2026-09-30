import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateItemAttributeDto } from 'src/item-attributes/dto/create-item-attribute.dto';
import { UpdateItemAttributeDto } from 'src/item-attributes/dto/update-item-attribute.dto';
import { CreateProductDto } from 'src/products/dto/create-product.dto';
import { UpdateProductDto } from 'src/products/dto/update-product.dto';
import { ProductType } from '@bitcrm/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const errorsFor = async (cls: any, payload: unknown) =>
  (await validate(plainToInstance(cls, payload))).map((e) => e.property);

describe('CreateItemAttributeDto', () => {
  it('takes a name and, optionally, one of the three Workiz types and the visibility flag', async () => {
    expect(await errorsFor(CreateItemAttributeDto, { name: 'Bin' })).toEqual([]);
    for (const type of ['text', 'number', 'quantity']) {
      expect(await errorsFor(CreateItemAttributeDto, { name: 'Bin', type, visible: true })).toEqual([]);
    }
  });

  it('rejects a blank name (after trimming), an unknown type and a non-boolean visibility', async () => {
    expect(await errorsFor(CreateItemAttributeDto, { name: '   ' })).toEqual(['name']);
    expect(await errorsFor(CreateItemAttributeDto, { name: 'Bin', type: 'date' })).toEqual(['type']);
    expect(await errorsFor(CreateItemAttributeDto, { name: 'Bin', visible: 'yes' })).toEqual(['visible']);
  });

  it('trims the name', () => {
    expect(plainToInstance(CreateItemAttributeDto, { name: '  ALL SKU  ' }).name).toBe('ALL SKU');
  });
});

describe('UpdateItemAttributeDto', () => {
  it('every field is optional', async () => {
    expect(await errorsFor(UpdateItemAttributeDto, {})).toEqual([]);
    expect(await errorsFor(UpdateItemAttributeDto, { visible: true })).toEqual([]);
  });

  it('a rename to a blank name is refused', async () => {
    expect(await errorsFor(UpdateItemAttributeDto, { name: ' ' })).toEqual(['name']);
  });
});

describe('customAttributes on the product DTOs', () => {
  const product = {
    name: 'Chain Guard',
    sku: 'SLK-3551',
    category: 'Door Hardware',
    type: ProductType.PRODUCT,
    costCompany: 20.16,
    costTech: 20.16,
    priceClient: 125,
    serialTracking: false,
    minimumStockLevel: 0,
  };

  it('create accepts a name → text map', async () => {
    expect(
      await errorsFor(CreateProductDto, { ...product, customAttributes: { Link_UHS: 'https://x' } }),
    ).toEqual([]);
  });

  it('update accepts a patch where null or "" clears one field', async () => {
    expect(
      await errorsFor(UpdateProductDto, { customAttributes: { Link_UHS: null, SKU_CRM: '', Bin: 'A4' } }),
    ).toEqual([]);
  });

  it('update refuses customAttributes: null — one request can never wipe every value', async () => {
    expect(await errorsFor(UpdateProductDto, { customAttributes: null })).toEqual(['customAttributes']);
  });

  it('refuses an array, a non-text value and a blank name', async () => {
    expect(await errorsFor(UpdateProductDto, { customAttributes: ['a'] })).toEqual(['customAttributes']);
    expect(await errorsFor(UpdateProductDto, { customAttributes: { Bin: 4 } })).toEqual(['customAttributes']);
    expect(await errorsFor(UpdateProductDto, { customAttributes: { ' ': 'x' } })).toEqual(['customAttributes']);
  });

  it('the booking and price-book flags are optional booleans; bookingPrice is a non-negative number', async () => {
    expect(
      await errorsFor(UpdateProductDto, { availableInBooking: true, priceBookEnabled: false, bookingPrice: 12.5 }),
    ).toEqual([]);
    expect(await errorsFor(UpdateProductDto, { availableInBooking: 'yes' })).toEqual(['availableInBooking']);
    expect(await errorsFor(UpdateProductDto, { bookingPrice: -1 })).toEqual(['bookingPrice']);
    // Optional: null clears them, as it does the other optional fields.
    expect(await errorsFor(UpdateProductDto, { availableInBooking: null, bookingPrice: null })).toEqual([]);
  });
});
