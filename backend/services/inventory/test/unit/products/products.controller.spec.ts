import { Test, TestingModule } from '@nestjs/testing';
import { ProductsController } from 'src/products/products.controller';
import { ProductsService } from 'src/products/products.service';
import {
  createMockProduct,
  createMockCreateProductDto,
} from '../mocks';

describe('ProductsController', () => {
  let controller: ProductsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      list: jest.fn(),
      findById: jest.fn(),
      findBySku: jest.fn(),
      update: jest.fn(),
      archive: jest.fn(),
      importFromCsv: jest.fn(),
      getPhotoUploadUrl: jest.fn(),
      getPhotoDownloadUrl: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProductsService, useValue: service }],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
  });

  describe('create', () => {
    it('should return success with created product', async () => {
      const product = createMockProduct();
      const dto = createMockCreateProductDto();
      service.create.mockResolvedValue(product);

      const result = await controller.create(dto);

      expect(result).toEqual({ success: true, data: product });
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('list', () => {
    it('should return success with items and pagination', async () => {
      const product = createMockProduct();
      service.list.mockResolvedValue({ items: [product], nextCursor: 'abc' });

      const result = await controller.list({ limit: 20 } as any);

      expect(result).toEqual({
        success: true,
        data: [product],
        pagination: { nextCursor: 'abc', count: 1 },
      });
    });
  });

  describe('findById', () => {
    it('should return success with product', async () => {
      const product = createMockProduct();
      service.findById.mockResolvedValue(product);

      const result = await controller.findById('prod-1');

      expect(result).toEqual({ success: true, data: product });
      expect(service.findById).toHaveBeenCalledWith('prod-1');
    });
  });

  describe('findBySku', () => {
    it('should return success with product', async () => {
      const product = createMockProduct();
      service.findBySku.mockResolvedValue(product);

      const result = await controller.findBySku('SKU-001');

      expect(result).toEqual({ success: true, data: product });
      expect(service.findBySku).toHaveBeenCalledWith('SKU-001');
    });
  });

  describe('update', () => {
    it('should return success with updated product', async () => {
      const product = createMockProduct({ name: 'Updated' });
      service.update.mockResolvedValue(product);

      const result = await controller.update('prod-1', { name: 'Updated' } as any);

      expect(result).toEqual({ success: true, data: product });
      expect(service.update).toHaveBeenCalledWith('prod-1', { name: 'Updated' });
    });
  });

  describe('archive', () => {
    it('should return success with archived product', async () => {
      const product = createMockProduct({ status: 'archived' as any });
      service.archive.mockResolvedValue(product);

      const result = await controller.archive('prod-1');

      expect(result).toEqual({ success: true, data: product });
      expect(service.archive).toHaveBeenCalledWith('prod-1');
    });
  });

  describe('importCsv', () => {
    it('should return success with import result', async () => {
      const importResult = { created: 2, updated: 1, errors: [] };
      service.importFromCsv.mockResolvedValue(importResult);
      const file = { buffer: Buffer.from('csv-data') } as Express.Multer.File;

      const result = await controller.importCsv(file);

      expect(result).toEqual({ success: true, data: importResult });
      expect(service.importFromCsv).toHaveBeenCalledWith(file.buffer);
    });
  });

  describe('getPhotoUploadUrl', () => {
    it('should return success with upload URL data', async () => {
      const urlData = { uploadUrl: 'https://s3.example.com/upload', key: 'products/prod-1/photo.png' };
      service.getPhotoUploadUrl.mockResolvedValue(urlData);

      const result = await controller.getPhotoUploadUrl('prod-1', 'image/png');

      expect(result).toEqual({ success: true, data: urlData });
      expect(service.getPhotoUploadUrl).toHaveBeenCalledWith('prod-1', 'image/png');
    });

    it('should default to image/jpeg when no contentType provided', async () => {
      const urlData = { uploadUrl: 'https://s3.example.com/upload', key: 'products/prod-1/photo.jpg' };
      service.getPhotoUploadUrl.mockResolvedValue(urlData);

      await controller.getPhotoUploadUrl('prod-1', undefined as any);

      expect(service.getPhotoUploadUrl).toHaveBeenCalledWith('prod-1', 'image/jpeg');
    });
  });

  describe('getPhotoDownloadUrl', () => {
    it('should return success with download URL', async () => {
      const urlData = { downloadUrl: 'https://s3.example.com/download' };
      service.getPhotoDownloadUrl.mockResolvedValue(urlData);

      const result = await controller.getPhotoDownloadUrl('prod-1');

      expect(result).toEqual({ success: true, data: urlData });
      expect(service.getPhotoDownloadUrl).toHaveBeenCalledWith('prod-1');
    });
  });
});
