import { BadRequestException } from '@nestjs/common';
import {
  ProductsService,
  mergeCustomAttributes,
  sameCustomAttributes,
} from 'src/products/products.service';
import {
  createMockCreateProductDto,
  createMockInventoryLogService,
  createMockItemCategoriesService,
  createMockProduct,
  createMockProductsCacheService,
  createMockProductsRepository,
  createMockS3Service,
} from '../mocks';

const catalog = ['ALL SKU', 'In Store Location', 'Link_UHS', 'SKU_CRM'].map((name, i) => ({
  id: `attr-${i}`,
  name,
  type: 'text',
  visible: false,
  resource: 'items',
}));

describe('mergeCustomAttributes', () => {
  it('sets the names sent and keeps every other value — imported orphans included', () => {
    expect(
      mergeCustomAttributes(
        { Link_UHS: 'https://old', workiz_attr_77: 'kept' },
        { Link_UHS: 'https://new', SKU_CRM: 'CRM-1' },
      ),
    ).toEqual({ Link_UHS: 'https://new', workiz_attr_77: 'kept', SKU_CRM: 'CRM-1' });
  });

  it('null or a blank value clears that one field', () => {
    expect(
      mergeCustomAttributes({ Link_UHS: 'x', SKU_CRM: 'y', 'ALL SKU': 'z' }, { Link_UHS: null, SKU_CRM: '  ' }),
    ).toEqual({ 'ALL SKU': 'z' });
  });

  it('answers null when nothing is left (the attribute is then removed)', () => {
    expect(mergeCustomAttributes({ Link_UHS: 'x' }, { Link_UHS: '' })).toBeNull();
    expect(mergeCustomAttributes(undefined, { Link_UHS: '' })).toBeNull();
  });
});

describe('sameCustomAttributes', () => {
  it('ignores key order and treats absent as empty', () => {
    expect(sameCustomAttributes({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true);
    expect(sameCustomAttributes(undefined, null)).toBe(true);
    expect(sameCustomAttributes({}, null)).toBe(true);
    expect(sameCustomAttributes({ a: '1' }, { a: '2' })).toBe(false);
  });
});

describe('ProductsService — custom field values', () => {
  let repository: ReturnType<typeof createMockProductsRepository>;
  let cache: ReturnType<typeof createMockProductsCacheService>;
  let itemAttributes: { listAll: jest.Mock };
  let service: ProductsService;

  beforeEach(() => {
    repository = createMockProductsRepository();
    cache = createMockProductsCacheService();
    itemAttributes = { listAll: jest.fn().mockResolvedValue(catalog) };
    service = new ProductsService(
      repository as any,
      cache as any,
      createMockS3Service() as any,
      undefined,
      createMockItemCategoriesService() as any,
      undefined,
      createMockInventoryLogService() as any,
      itemAttributes as any,
    );
  });

  describe('update', () => {
    it('writes the merged map: the values not sent are kept', async () => {
      cache.get.mockResolvedValue(
        createMockProduct({ customAttributes: { Link_UHS: 'https://old', workiz_attr_77: 'kept' } }),
      );
      repository.update.mockImplementation(async (_id, attrs) => createMockProduct(attrs));

      await service.update('prod-1', {
        name: 'Chain Guard',
        customAttributes: { 'In Store Location': 'Aisle 4', Link_UHS: null },
      } as any);

      expect(repository.update).toHaveBeenCalledWith('prod-1', {
        name: 'Chain Guard',
        customAttributes: { workiz_attr_77: 'kept', 'In Store Location': 'Aisle 4' },
      });
    });

    it('clearing the last value removes the attribute (null to the repository)', async () => {
      cache.get.mockResolvedValue(createMockProduct({ customAttributes: { SKU_CRM: 'CRM-1' } }));
      repository.update.mockResolvedValue(createMockProduct());

      await service.update('prod-1', { customAttributes: { SKU_CRM: '' } } as any);

      expect(repository.update).toHaveBeenCalledWith('prod-1', { customAttributes: null });
    });

    it('a patch that changes nothing writes no customAttributes', async () => {
      cache.get.mockResolvedValue(createMockProduct({ customAttributes: { SKU_CRM: 'CRM-1' } }));
      repository.update.mockResolvedValue(createMockProduct());

      await service.update('prod-1', { priceClient: 30, customAttributes: { SKU_CRM: 'CRM-1', Link_UHS: '' } } as any);

      expect(repository.update).toHaveBeenCalledWith('prod-1', { priceClient: 30 });
    });

    it('refuses a name that is not a field of the catalog (400) and writes nothing', async () => {
      cache.get.mockResolvedValue(createMockProduct());

      await expect(
        service.update('prod-1', { customAttributes: { Colour: 'red', SKU_CRM: 'x' } } as any),
      ).rejects.toThrow(new BadRequestException('Unknown custom field: "Colour"'));
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('an edit without customAttributes never reads the catalog', async () => {
      cache.get.mockResolvedValue(createMockProduct());
      repository.update.mockResolvedValue(createMockProduct());

      await service.update('prod-1', { name: 'X' } as any);

      expect(itemAttributes.listAll).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith('prod-1', { name: 'X' });
    });
  });

  describe('create', () => {
    it('stores only the non-empty values', async () => {
      await service.create(
        createMockCreateProductDto({
          customAttributes: { Link_UHS: 'https://uhs', SKU_CRM: '', 'ALL SKU': null },
        } as any),
      );

      const stored = repository.create.mock.calls[0][0];
      expect(stored.customAttributes).toEqual({ Link_UHS: 'https://uhs' });
    });

    it('stores no customAttributes attribute when every value is empty', async () => {
      await service.create(createMockCreateProductDto({ customAttributes: { SKU_CRM: '' } } as any));

      expect('customAttributes' in repository.create.mock.calls[0][0]).toBe(false);
    });

    it('refuses an unknown name', async () => {
      await expect(
        service.create(createMockCreateProductDto({ customAttributes: { Colour: 'red' } } as any)),
      ).rejects.toThrow(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('carries the booking and price-book flags through', async () => {
      await service.create(
        createMockCreateProductDto({ availableInBooking: true, bookingPrice: 40, priceBookEnabled: false } as any),
      );

      expect(repository.create.mock.calls[0][0]).toMatchObject({
        availableInBooking: true,
        bookingPrice: 40,
        priceBookEnabled: false,
      });
    });
  });
});
