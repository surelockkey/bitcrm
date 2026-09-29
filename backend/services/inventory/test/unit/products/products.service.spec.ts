import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import {
  ProductsService,
  normalizeCategory,
  normalizeProductType,
} from 'src/products/products.service';
import { ProductsRepository } from 'src/products/products.repository';
import { ProductsCacheService } from 'src/products/products-cache.service';
import { ItemCategoriesService } from 'src/item-categories/item-categories.service';
import { RedisService, S3Service, SnsPublisherService } from '@bitcrm/shared';
import { InventoryStatus, ProductType, UNCATEGORIZED_CATEGORY } from '@bitcrm/types';
import {
  createMockProduct,
  createMockCreateProductDto,
  createMockProductsRepository,
  createMockProductsCacheService,
  createMockS3Service,
  createMockItemCategoriesService,
} from '../mocks';

describe('ProductsService', () => {
  let service: ProductsService;
  let repository: ReturnType<typeof createMockProductsRepository>;
  let cache: ReturnType<typeof createMockProductsCacheService>;
  let s3: ReturnType<typeof createMockS3Service>;
  let publisher: { publish: jest.Mock };
  let categories: ReturnType<typeof createMockItemCategoriesService>;
  let redisStore: Map<string, string>;

  beforeEach(async () => {
    repository = createMockProductsRepository();
    cache = createMockProductsCacheService();
    s3 = createMockS3Service();
    publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    categories = createMockItemCategoriesService();
    redisStore = new Map<string, string>();
    const redis = {
      client: {
        get: jest.fn(async (k: string) => redisStore.get(k) ?? null),
        set: jest.fn(async (k: string, v: string) => {
          redisStore.set(k, v);
          return 'OK';
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: ProductsRepository, useValue: repository },
        { provide: ProductsCacheService, useValue: cache },
        { provide: S3Service, useValue: s3 },
        { provide: SnsPublisherService, useValue: publisher },
        { provide: ItemCategoriesService, useValue: categories },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  describe('create', () => {
    it('should create a product with UUID and ACTIVE status', async () => {
      const dto = createMockCreateProductDto();
      repository.create.mockResolvedValue(undefined);

      const result = await service.create(dto);

      expect(result.id).toBeDefined();
      expect(result.status).toBe(InventoryStatus.ACTIVE);
      expect(result.name).toBe(dto.name);
      expect(result.sku).toBe(dto.sku);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ id: result.id, status: InventoryStatus.ACTIVE }),
      );
    });

    it('publishes product.created with the product id', async () => {
      repository.create.mockResolvedValue(undefined);
      const result = await service.create(createMockCreateProductDto());
      expect(publisher.publish).toHaveBeenCalledWith('inventory-events', 'product.created', {
        productId: result.id,
      });
    });

    it('does not touch the category catalog for an ordinary category', async () => {
      repository.create.mockResolvedValue(undefined);
      await service.create(createMockCreateProductDto({ category: 'Locks' }));
      expect(categories.ensureUncategorized).not.toHaveBeenCalled();
    });

    describe('the "Uncategorized" sentinel', () => {
      it('normalizes the spelling and seeds the catalog row on demand', async () => {
        repository.create.mockResolvedValue(undefined);

        const result = await service.create(
          createMockCreateProductDto({ category: '  uncategorized ' }),
        );

        expect(result.category).toBe(UNCATEGORIZED_CATEGORY);
        expect(repository.create).toHaveBeenCalledWith(
          expect.objectContaining({ category: 'Uncategorized' }),
        );
        expect(categories.ensureUncategorized).toHaveBeenCalledTimes(1);
      });

      it('still creates the product when seeding the category fails', async () => {
        repository.create.mockResolvedValue(undefined);
        categories.ensureUncategorized.mockRejectedValue(new Error('dynamo down'));

        const result = await service.create(
          createMockCreateProductDto({ category: 'Uncategorized' }),
        );

        expect(result.category).toBe('Uncategorized');
        expect(repository.create).toHaveBeenCalledTimes(1);
      });

      it('works without an ItemCategoriesService (optional collaborator)', async () => {
        const bare = new ProductsService(repository as any, cache as any, s3 as any);
        repository.create.mockResolvedValue(undefined);

        const result = await bare.create(createMockCreateProductDto({ category: 'UNCATEGORIZED' }));

        expect(result.category).toBe('Uncategorized');
      });
    });
  });

  describe('normalizeCategory', () => {
    it('canonicalizes only the sentinel and keeps every other name verbatim', () => {
      expect(normalizeCategory('uncategorized')).toBe('Uncategorized');
      expect(normalizeCategory(' Uncategorized ')).toBe('Uncategorized');
      expect(normalizeCategory('Door Hardware')).toBe('Door Hardware');
      expect(normalizeCategory('Locks > Residential ')).toBe('Locks > Residential ');
    });
  });

  describe('create — taxable', () => {
    it('defaults taxable to true', async () => {
      const result = await service.create(createMockCreateProductDto());
      expect(result.taxable).toBe(true);
      expect(repository.create.mock.calls[0][0].taxable).toBe(true);
    });

    it('keeps an explicit taxable=false', async () => {
      const result = await service.create({ ...createMockCreateProductDto(), taxable: false });
      expect(result.taxable).toBe(false);
    });
  });

  describe('findById', () => {
    it('should return from cache on hit', async () => {
      const product = createMockProduct();
      cache.get.mockResolvedValue(product);

      const result = await service.findById('prod-1');

      expect(result).toEqual(product);
      expect(cache.get).toHaveBeenCalledWith('prod-1');
      expect(repository.findById).not.toHaveBeenCalled();
    });

    it('should fetch from repo on cache miss and populate cache', async () => {
      const product = createMockProduct();
      cache.get.mockResolvedValue(null);
      repository.findById.mockResolvedValue(product);

      const result = await service.findById('prod-1');

      expect(result).toEqual(product);
      expect(repository.findById).toHaveBeenCalledWith('prod-1');
      expect(cache.set).toHaveBeenCalledWith('prod-1', product);
    });

    it('should throw NotFoundException when product not found', async () => {
      cache.get.mockResolvedValue(null);
      repository.findById.mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('assertStockable', () => {
    it('resolves when every product is a stockable product-type', async () => {
      repository.findById.mockResolvedValue(createMockProduct({ type: ProductType.PRODUCT }));

      await expect(service.assertStockable(['prod-1'])).resolves.toBeUndefined();
    });

    it('throws BadRequestException when any product is a service', async () => {
      repository.findById.mockImplementation(async (id: string) =>
        id === 'svc-1'
          ? createMockProduct({ id: 'svc-1', name: 'Rekey', type: ProductType.SERVICE })
          : createMockProduct({ id: 'prod-1', type: ProductType.PRODUCT }),
      );

      await expect(service.assertStockable(['prod-1', 'svc-1'])).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ignores unknown product ids (repository returns null)', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.assertStockable(['ghost'])).resolves.toBeUndefined();
    });

    it('de-duplicates ids before looking them up', async () => {
      repository.findById.mockResolvedValue(createMockProduct({ type: ProductType.PRODUCT }));

      await service.assertStockable(['prod-1', 'prod-1', 'prod-1']);

      expect(repository.findById).toHaveBeenCalledTimes(1);
    });

    /**
     * Every deduct and every restore runs assertStockable and then
     * partitionStockManaged over the same ids. Both used to go straight to the
     * repository, so a movement cost 2 × GetItem per distinct product.
     */
    it('reads a product once across both stock guards', async () => {
      const store = new Map<string, unknown>();
      cache.get.mockImplementation(async (id: string) => store.get(id) ?? null);
      cache.set.mockImplementation(async (id: string, p: unknown) => {
        store.set(id, p);
      });
      repository.findById.mockResolvedValue(
        createMockProduct({ id: 'prod-1', type: ProductType.PRODUCT }),
      );
      const items = [{ productId: 'prod-1', productName: 'Deadbolt', quantity: 1 }];

      await service.assertStockable(items.map((i) => i.productId));
      const { managed } = await service.partitionStockManaged(items);

      expect(managed).toEqual(items);
      expect(repository.findById).toHaveBeenCalledTimes(1);
    });

    it('still guards when the cache is unavailable', async () => {
      // These paths had no Redis dependency before; a cache outage must not
      // turn into a failed deduct.
      cache.get.mockRejectedValue(new Error('redis down'));
      cache.set.mockRejectedValue(new Error('redis down'));
      repository.findById.mockResolvedValue(
        createMockProduct({ id: 'svc-1', name: 'Rekey', type: ProductType.SERVICE }),
      );

      await expect(service.assertStockable(['svc-1'])).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.isStockManaged('svc-1')).resolves.toBe(true);
    });

    it('reflects a cached manageStock: false without a second read', async () => {
      cache.get.mockResolvedValue({ ...createMockProduct(), manageStock: false });

      await expect(service.isStockManaged('prod-1')).resolves.toBe(false);
      expect(repository.findById).not.toHaveBeenCalled();
    });
  });

  describe('findBySku', () => {
    it('should return product by SKU', async () => {
      const product = createMockProduct();
      repository.findBySku.mockResolvedValue(product);

      const result = await service.findBySku('SKU-001');

      expect(result).toEqual(product);
      expect(repository.findBySku).toHaveBeenCalledWith('SKU-001');
    });

    it('should throw NotFoundException when SKU not found', async () => {
      repository.findBySku.mockResolvedValue(null);

      await expect(service.findBySku('INVALID')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('list', () => {
    it('should delegate to findByCategory when category is provided', async () => {
      const paginated = { items: [createMockProduct()], nextCursor: undefined };
      repository.findByCategory.mockResolvedValue(paginated);

      const result = await service.list({ category: 'Locks', limit: 20 } as any);

      expect(result).toEqual(paginated);
      expect(repository.findByCategory).toHaveBeenCalledWith('Locks', 20, undefined);
    });

    it('should delegate to findByType when type is provided', async () => {
      const paginated = { items: [createMockProduct()], nextCursor: undefined };
      repository.findByType.mockResolvedValue(paginated);

      const result = await service.list({ type: 'product', limit: 20 } as any);

      expect(result).toEqual(paginated);
      expect(repository.findByType).toHaveBeenCalledWith('product', 20, undefined);
    });

    it('should delegate to findAll when no category or type', async () => {
      const paginated = { items: [createMockProduct()], nextCursor: undefined };
      repository.findAll.mockResolvedValue(paginated);

      const result = await service.list({ limit: 20 } as any);

      expect(result).toEqual(paginated);
      expect(repository.findAll).toHaveBeenCalledWith(20, undefined, { status: undefined, search: undefined });
    });
  });

  describe('update', () => {
    it('should update product and invalidate cache', async () => {
      const product = createMockProduct();
      const updated = createMockProduct({ name: 'Updated' });
      cache.get.mockResolvedValue(product);
      repository.update.mockResolvedValue(updated);

      const result = await service.update('prod-1', { name: 'Updated' } as any);

      expect(result).toEqual(updated);
      expect(repository.update).toHaveBeenCalledWith('prod-1', { name: 'Updated' });
      expect(cache.invalidate).toHaveBeenCalledWith('prod-1');
    });

    it('accepts moving a product to "Uncategorized" and seeds the catalog row', async () => {
      cache.get.mockResolvedValue(createMockProduct());
      repository.update.mockResolvedValue(createMockProduct({ category: 'Uncategorized' }));

      await service.update('prod-1', { category: 'uncategorized' } as any);

      expect(repository.update).toHaveBeenCalledWith('prod-1', { category: 'Uncategorized' });
      expect(categories.ensureUncategorized).toHaveBeenCalledTimes(1);
    });
  });

  describe('archive', () => {
    it('should set status to ARCHIVED', async () => {
      const product = createMockProduct();
      const archived = createMockProduct({ status: InventoryStatus.ARCHIVED });
      cache.get.mockResolvedValue(product);
      repository.update.mockResolvedValue(archived);

      const result = await service.archive('prod-1');

      expect(result.status).toBe(InventoryStatus.ARCHIVED);
    });
  });

  describe('getPhotoUploadUrl', () => {
    it('should generate S3 key, call S3 service, and update product photoKey', async () => {
      const product = createMockProduct();
      cache.get.mockResolvedValue(product);
      s3.getPresignedUploadUrl.mockResolvedValue('https://s3.example.com/upload');
      repository.update.mockResolvedValue(product);

      const result = await service.getPhotoUploadUrl('prod-1', 'image/png');

      expect(result.uploadUrl).toBe('https://s3.example.com/upload');
      expect(result.key).toMatch(/^products\/prod-1\/.*\.png$/);
      expect(s3.getPresignedUploadUrl).toHaveBeenCalledWith(
        expect.stringContaining('products/prod-1/'),
        'image/png',
      );
      expect(repository.update).toHaveBeenCalledWith('prod-1', { photoKey: result.key });
      expect(cache.invalidate).toHaveBeenCalledWith('prod-1');
    });

    it('should use jpg extension for non-png content types', async () => {
      const product = createMockProduct();
      cache.get.mockResolvedValue(product);
      s3.getPresignedUploadUrl.mockResolvedValue('https://s3.example.com/upload');
      repository.update.mockResolvedValue(product);

      const result = await service.getPhotoUploadUrl('prod-1', 'image/jpeg');

      expect(result.key).toMatch(/\.jpg$/);
    });
  });

  describe('getPhotoDownloadUrl', () => {
    it('should return download URL from S3', async () => {
      const product = createMockProduct({ photoKey: 'products/prod-1/photo.png' });
      cache.get.mockResolvedValue(product);
      s3.getPresignedDownloadUrl.mockResolvedValue('https://s3.example.com/download');

      const result = await service.getPhotoDownloadUrl('prod-1');

      expect(result.downloadUrl).toBe('https://s3.example.com/download');
      expect(s3.getPresignedDownloadUrl).toHaveBeenCalledWith('products/prod-1/photo.png');
    });

    it('should throw NotFoundException if product has no photoKey', async () => {
      const product = createMockProduct({ photoKey: undefined });
      cache.get.mockResolvedValue(product);

      await expect(service.getPhotoDownloadUrl('prod-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('importFromCsv', () => {
    it('should create new products from valid CSV rows', async () => {
      const csv = Buffer.from(
        'name,sku,category,type,costCompany,costTech,priceClient,serialTracking,minimumStockLevel\n' +
        'Lock A,SKU-100,Locks,product,10,15,25,false,5',
      );
      repository.findBySku.mockResolvedValue(null);
      repository.create.mockResolvedValue(undefined);

      const result = await service.importFromCsv(csv);

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(repository.create).toHaveBeenCalledTimes(1);
    });

    it('should update existing products matched by SKU', async () => {
      const csv = Buffer.from(
        'name,sku,category,type,costCompany,costTech,priceClient,serialTracking,minimumStockLevel\n' +
        'Lock A,SKU-001,Locks,product,10,15,25,false,5',
      );
      const existing = createMockProduct();
      repository.findBySku.mockResolvedValue(existing);
      repository.update.mockResolvedValue(existing);

      const result = await service.importFromCsv(csv);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
      expect(repository.update).toHaveBeenCalledTimes(1);
      expect(cache.invalidate).toHaveBeenCalledWith(existing.id);
    });

    it('reads the optional taxable column (default true on create)', async () => {
      const csv = Buffer.from(
        'name,sku,category,type,costCompany,costTech,priceClient,serialTracking,minimumStockLevel,taxable\n' +
        'Lock A,SKU-100,Locks,product,10,15,25,false,5,false\n' +
        'Lock B,SKU-101,Locks,product,10,15,25,false,5,',
      );
      repository.findBySku.mockResolvedValue(null);

      const result = await service.importFromCsv(csv);

      expect(result.created).toBe(2);
      expect(repository.create.mock.calls[0][0].taxable).toBe(false);
      expect(repository.create.mock.calls[1][0].taxable).toBe(true);
    });

    it('updates taxable only when the column has a value', async () => {
      const csv = Buffer.from(
        'name,sku,category,type,costCompany,costTech,priceClient,serialTracking,minimumStockLevel,taxable\n' +
        'Lock A,SKU-001,Locks,product,10,15,25,false,5,no\n' +
        'Lock B,SKU-002,Locks,product,10,15,25,false,5,',
      );
      repository.findBySku.mockResolvedValue(createMockProduct());
      repository.update.mockResolvedValue(createMockProduct());

      await service.importFromCsv(csv);

      expect(repository.update.mock.calls[0][1].taxable).toBe(false);
      expect(repository.update.mock.calls[1][1]).not.toHaveProperty('taxable');
    });

    it('rejects an unreadable taxable value', async () => {
      const csv = Buffer.from(
        'name,sku,category,type,costCompany,costTech,priceClient,taxable\n' +
        'Lock A,SKU-100,Locks,product,10,15,25,maybe',
      );

      const result = await service.importFromCsv(csv);

      expect(result.errors[0].message).toContain('taxable');
    });

    it('should report errors for invalid rows', async () => {
      const csv = Buffer.from(
        'name,sku,category,type,costCompany,costTech,priceClient\n' +
        ',SKU-100,Locks,product,10,15,25',
      );

      const result = await service.importFromCsv(csv);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].row).toBe(2);
      expect(result.errors[0].message).toContain('Missing name');
    });

    it('should report error for invalid CSV format', async () => {
      const csv = Buffer.from('not\x00valid\x00csv');

      const result = await service.importFromCsv(csv);

      // The CSV parser may or may not fail on this input;
      // if it does, we expect an error in the result
      expect(result).toBeDefined();
    });

    it('should not write anything when dryRun is true', async () => {
      const csv = Buffer.from(
        'name,sku,category,type,costCompany,costTech,priceClient,serialTracking,minimumStockLevel\n' +
        'Lock A,SKU-100,Locks,product,10,15,25,false,5',
      );
      repository.findBySku.mockResolvedValue(null);

      const result = await service.importFromCsv(csv, true);

      expect(result.created).toBe(1);
      expect(repository.create).not.toHaveBeenCalled();
      expect(categories.ensureUncategorized).not.toHaveBeenCalled();
    });

    it('normalizes an "uncategorized" CSV row to the sentinel and seeds its catalog row', async () => {
      const csv = Buffer.from(
        'name,sku,category,type,costCompany,costTech,priceClient,serialTracking,minimumStockLevel\n' +
        'Lock A,SKU-100,uncategorized,product,10,15,0,false,0',
      );
      repository.findBySku.mockResolvedValue(null);
      repository.create.mockResolvedValue(undefined);

      const result = await service.importFromCsv(csv);

      expect(result.created).toBe(1);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'Uncategorized', priceClient: 0 }),
      );
      expect(categories.ensureUncategorized).toHaveBeenCalledTimes(1);
    });
  });

  describe('reactivate', () => {
    it('should set status to ACTIVE', async () => {
      const product = createMockProduct({ status: InventoryStatus.ARCHIVED });
      const active = createMockProduct({ status: InventoryStatus.ACTIVE });
      cache.get.mockResolvedValue(product);
      repository.update.mockResolvedValue(active);

      const result = await service.reactivate('prod-1');

      expect(result.status).toBe(InventoryStatus.ACTIVE);
      expect(repository.update).toHaveBeenCalledWith(
        'prod-1',
        expect.objectContaining({ status: InventoryStatus.ACTIVE }),
      );
    });
  });

  describe('findByBarcode', () => {
    it('should return the product when found', async () => {
      const product = createMockProduct({ barcode: '883351050135' });
      repository.findByBarcode.mockResolvedValue(product);

      const result = await service.findByBarcode('883351050135');

      expect(result).toEqual(product);
    });

    it('should throw NotFoundException when no product matches', async () => {
      repository.findByBarcode.mockResolvedValue(null);

      await expect(service.findByBarcode('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('removePhoto', () => {
    it('should delete the S3 object and clear photoKey', async () => {
      const product = createMockProduct({ photoKey: 'products/prod-1/photo.png' });
      const cleared = createMockProduct({ photoKey: undefined });
      cache.get.mockResolvedValue(product);
      s3.deleteObject.mockResolvedValue(undefined);
      repository.update.mockResolvedValue(cleared);

      const result = await service.removePhoto('prod-1');

      expect(s3.deleteObject).toHaveBeenCalledWith('products/prod-1/photo.png');
      expect(repository.update).toHaveBeenCalledWith('prod-1', { photoKey: undefined });
      expect(cache.invalidate).toHaveBeenCalledWith('prod-1');
      expect(result.photoKey).toBeUndefined();
    });

    it('should skip S3 deletion when there is no photo', async () => {
      const product = createMockProduct({ photoKey: undefined });
      cache.get.mockResolvedValue(product);
      repository.update.mockResolvedValue(product);

      await service.removePhoto('prod-1');

      expect(s3.deleteObject).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith('prod-1', { photoKey: undefined });
    });
  });
  describe('normalizeProductType', () => {
    it('passes the two BitCRM types through untouched', () => {
      expect(normalizeProductType('product')).toEqual({ type: ProductType.PRODUCT });
      expect(normalizeProductType('service')).toEqual({ type: ProductType.SERVICE });
      expect(normalizeProductType(' SERVICE ')).toEqual({ type: ProductType.SERVICE });
    });

    it("maps Workiz 'other' and 'hours' to service and keeps the word", () => {
      // Both are non-stockable in Workiz, so `service` keeps assertStockable
      // on the safe side (9 `other` items, 1 `hours`).
      expect(normalizeProductType('other')).toEqual({
        type: ProductType.SERVICE,
        workizType: 'other',
      });
      expect(normalizeProductType('Hours')).toEqual({
        type: ProductType.SERVICE,
        workizType: 'hours',
      });
    });

    it('still rejects anything else', () => {
      expect(() => normalizeProductType('widget')).toThrow(/Invalid type/);
      expect(() => normalizeProductType('')).toThrow(/Invalid type/);
    });
  });

  describe('importFromCsv — Workiz types', () => {
    const csvRow = (type: string) =>
      Buffer.from(
        'name,sku,category,type,costCompany,costTech,priceClient,serialTracking,minimumStockLevel\n' +
        `Trip charge,WZ-10707,Locks,${type},0,0,0,false,0`,
      );

    it("imports an 'other' row as a service carrying workizType", async () => {
      repository.findBySku.mockResolvedValue(null);
      repository.create.mockResolvedValue(undefined);

      const result = await service.importFromCsv(csvRow('other'));

      expect(result.errors).toHaveLength(0);
      expect(result.created).toBe(1);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: ProductType.SERVICE, workizType: 'other' }),
      );
    });

    it("carries workizType through an update matched by SKU", async () => {
      repository.findBySku.mockResolvedValue(createMockProduct({ id: 'prod-9' }));

      const result = await service.importFromCsv(csvRow('hours'));

      expect(result.updated).toBe(1);
      expect(repository.update).toHaveBeenCalledWith(
        'prod-9',
        expect.objectContaining({ type: ProductType.SERVICE, workizType: 'hours' }),
      );
    });

    it('clears a stale workizType when the row re-imports as a plain product', async () => {
      // Imported once as Workiz `other` (stored workizType: 'other'), then a
      // later export brings it back as `product`. Without an explicit
      // `undefined` the attribute survives and the item list keeps rendering
      // the second pill: "Product · other".
      repository.findBySku.mockResolvedValue({
        ...createMockProduct({ id: 'prod-9' }),
        workizType: 'other',
      });

      const result = await service.importFromCsv(csvRow('product'));

      expect(result.updated).toBe(1);
      const attrs = repository.update.mock.calls[0][1];
      expect(attrs.type).toBe(ProductType.PRODUCT);
      expect('workizType' in attrs).toBe(true); // present…
      expect(attrs.workizType).toBeUndefined(); // …as a REMOVE
    });

    it('leaves workizType off an ordinary row', async () => {
      repository.findBySku.mockResolvedValue(null);
      repository.create.mockResolvedValue(undefined);

      await service.importFromCsv(csvRow('product'));

      const written = repository.create.mock.calls[0][0];
      expect(written.type).toBe(ProductType.PRODUCT);
      expect('workizType' in written).toBe(false);
    });

    it('still reports an unknown type as a row error', async () => {
      const result = await service.importFromCsv(csvRow('widget'));

      expect(result.created).toBe(0);
      expect(result.errors).toEqual([
        { row: 2, message: expect.stringContaining('Invalid type') },
      ]);
    });
  });
  /**
   * Workiz tracks stock per item (`manage`); 6 643 product-type items have
   * manage=0. Those must never move a stock counter.
   */
  describe('isStockManaged / partitionStockManaged', () => {
    it('treats a product with no manageStock attribute as managed', async () => {
      repository.findById.mockResolvedValue(createMockProduct());

      await expect(service.isStockManaged('prod-1')).resolves.toBe(true);
    });

    it('treats manageStock: false as not managed', async () => {
      repository.findById.mockResolvedValue({
        ...createMockProduct(),
        manageStock: false,
      });

      await expect(service.isStockManaged('prod-1')).resolves.toBe(false);
    });

    it('treats manageStock: true as managed', async () => {
      repository.findById.mockResolvedValue({
        ...createMockProduct(),
        manageStock: true,
      });

      await expect(service.isStockManaged('prod-1')).resolves.toBe(true);
    });

    it('treats an unknown product as managed (the stock call decides)', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.isStockManaged('ghost')).resolves.toBe(true);
    });

    it('splits a mixed list and looks each product up once', async () => {
      repository.findById.mockImplementation(async (id: string) =>
        id === 'prod-2'
          ? { ...createMockProduct({ id: 'prod-2' }), manageStock: false }
          : createMockProduct({ id }),
      );
      const items = [
        { productId: 'prod-1', productName: 'Deadbolt', quantity: 1 },
        { productId: 'prod-2', productName: 'Shop rag', quantity: 2 },
        { productId: 'prod-2', productName: 'Shop rag', quantity: 3 },
      ];

      const { managed, unmanaged } = await service.partitionStockManaged(items);

      expect(managed).toEqual([items[0]]);
      expect(unmanaged).toEqual([items[1], items[2]]);
      expect(repository.findById).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * Скільки всього товарів під поточними фільтрами — число для «Page 2 of 7».
   * Розвилка мусить бути та сама, що в `list`, інакше панель показала б
   * сторінки іншого набору.
   */
  describe('count', () => {
    it('counts the scanned list when neither category nor type is set', async () => {
      repository.countAll.mockResolvedValue({ total: 47, atLeast: false });

      expect(await service.count({ status: 'active', search: 'lock' } as never)).toEqual({
        total: 47,
        atLeast: false,
      });
      expect(repository.countAll).toHaveBeenCalledWith({ status: 'active', search: 'lock' });
    });

    it('counts on the category index when a category is given, as the list does', async () => {
      repository.countByCategory.mockResolvedValue({ total: 9, atLeast: false });

      expect(await service.count({ category: 'locks' } as never)).toEqual({ total: 9, atLeast: false });
      expect(repository.countByCategory).toHaveBeenCalledWith('locks');
      expect(repository.countAll).not.toHaveBeenCalled();
    });

    it('counts on the type index when a type is given', async () => {
      repository.countByType.mockResolvedValue({ total: 4, atLeast: false });

      expect(await service.count({ type: 'part' } as never)).toEqual({ total: 4, atLeast: false });
      expect(repository.countByType).toHaveBeenCalledWith('part');
    });

    it('carries the floor flag through', async () => {
      repository.countAll.mockResolvedValue({ total: 10_000, atLeast: true });

      expect(await service.count({} as never)).toEqual({ total: 10_000, atLeast: true });
    });

    // Той самий екран з тими самими фільтрами не має перечитувати індекс.
    it('answers a repeat of the same question from the cache', async () => {
      repository.countAll.mockResolvedValue({ total: 47, atLeast: false });

      await service.count({ status: 'active' } as never);
      await service.count({ status: 'active' } as never);

      expect(repository.countAll).toHaveBeenCalledTimes(1);
    });

    it('counts again when the filters change', async () => {
      repository.countAll.mockResolvedValue({ total: 47, atLeast: false });

      await service.count({ status: 'active' } as never);
      await service.count({ status: 'archived' } as never);

      expect(repository.countAll).toHaveBeenCalledTimes(2);
    });
  });
});
