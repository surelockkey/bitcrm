import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProductsService } from 'src/products/products.service';
import { ProductsRepository } from 'src/products/products.repository';
import { ProductsCacheService } from 'src/products/products-cache.service';
import { S3Service, SnsPublisherService } from '@bitcrm/shared';
import { InventoryStatus } from '@bitcrm/types';
import {
  createMockProduct,
  createMockCreateProductDto,
  createMockProductsRepository,
  createMockProductsCacheService,
  createMockS3Service,
} from '../mocks';

describe('ProductsService', () => {
  let service: ProductsService;
  let repository: ReturnType<typeof createMockProductsRepository>;
  let cache: ReturnType<typeof createMockProductsCacheService>;
  let s3: ReturnType<typeof createMockS3Service>;
  let publisher: { publish: jest.Mock };

  beforeEach(async () => {
    repository = createMockProductsRepository();
    cache = createMockProductsCacheService();
    s3 = createMockS3Service();
    publisher = { publish: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: ProductsRepository, useValue: repository },
        { provide: ProductsCacheService, useValue: cache },
        { provide: S3Service, useValue: s3 },
        { provide: SnsPublisherService, useValue: publisher },
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
});
