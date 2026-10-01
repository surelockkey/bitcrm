import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ProductsController } from 'src/products/products.controller';
import { ProductsService } from 'src/products/products.service';
import { ProductThumbnailsService } from 'src/products/product-thumbnails';
import {
  createMockProduct,
  createMockCreateProductDto,
  createMockJwtUser,
  createMockResolvedPermissions,
} from '../mocks';

describe('ProductsController', () => {
  let controller: ProductsController;
  let service: Record<string, jest.Mock>;
  let thumbnails: Record<string, jest.Mock>;
  const user = createMockJwtUser();
  /** A caller who may see money: the product answers keep `costCompany`. */
  const money = {
    resolvedPermissions: createMockResolvedPermissions({
      permissions: { products: { view: true, edit: true }, financials: { view: true } },
    }),
  };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      list: jest.fn(),
      count: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      findBySku: jest.fn(),
      update: jest.fn(),
      archive: jest.fn(),
      reactivate: jest.fn(),
      importFromCsv: jest.fn(),
      getPhotoUploadUrl: jest.fn(),
      getPhotoDownloadUrl: jest.fn(),
    };

    // A list page's items pass through as they are unless a test says otherwise.
    thumbnails = {
      withThumbnails: jest.fn(async (items: unknown[]) => items),
      complete: jest.fn(),
      removePhoto: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        { provide: ProductsService, useValue: service },
        { provide: ProductThumbnailsService, useValue: thumbnails },
      ],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
  });

  /**
   * Правило власника: гроші — за financials.view. Собівартість компанії
   * (`costCompany`) у відповідях про товар лише для того, хто її бачить (Super
   * Admin — завжди); `costTech` лишається — технік бачить свою ціну.
   */
  describe('company cost follows financials.view', () => {
    const product = createMockProduct({ costCompany: 10, costTech: 15, priceClient: 25 });
    const noMoney = { resolvedPermissions: createMockResolvedPermissions() };
    const superAdmin = {
      resolvedPermissions: createMockResolvedPermissions({ isSystemRole: true, roleName: 'Super Admin', permissions: {} }),
    };

    beforeEach(() => {
      service.findById.mockResolvedValue(product);
      service.findBySku.mockResolvedValue(product);
      service.findByBarcode = jest.fn().mockResolvedValue(product);
      service.list.mockResolvedValue({ items: [product], nextCursor: undefined });
      service.update.mockResolvedValue(product);
      service.create.mockResolvedValue(product);
      service.archive.mockResolvedValue(product);
      service.reactivate.mockResolvedValue(product);
    });

    it('leaves costCompany out of every product answer without financials.view, keeping costTech', async () => {
      const answers = [
        (await controller.findById('prod-1', noMoney)).data,
        (await controller.findBySku('SKU-001', noMoney)).data,
        (await controller.findByBarcode('123', noMoney)).data,
        (await controller.list({ limit: 20 } as any, noMoney)).data[0],
        (await controller.update('prod-1', { name: 'x' } as any, user, noMoney)).data,
        (await controller.create(createMockCreateProductDto(), user, noMoney)).data,
        (await controller.archive('prod-1', user, noMoney)).data,
        (await controller.reactivate('prod-1', user, noMoney)).data,
      ];

      for (const answer of answers) {
        expect(answer).not.toHaveProperty('costCompany');
        expect(answer.costTech).toBe(15);
        expect(answer.priceClient).toBe(25);
      }
    });

    it('keeps it for financials.view and for the Super Admin', async () => {
      expect((await controller.findById('prod-1', money)).data.costCompany).toBe(10);
      expect((await controller.findById('prod-1', superAdmin)).data.costCompany).toBe(10);
    });

    it('keeps it on the internal read, which services use', async () => {
      expect((await controller.findByIdInternal('prod-1')).data.costCompany).toBe(10);
    });
  });

  // Every write hands the caller to the service: the audit log names who did it.
  describe('create', () => {
    it('should return success with created product', async () => {
      const product = createMockProduct();
      const dto = createMockCreateProductDto();
      service.create.mockResolvedValue(product);

      const result = await controller.create(dto, user, money);

      expect(result).toEqual({ success: true, data: product });
      expect(service.create).toHaveBeenCalledWith(dto, user);
    });
  });

  describe('list', () => {
    it('should return success with items and pagination', async () => {
      const product = createMockProduct();
      service.list.mockResolvedValue({ items: [product], nextCursor: 'abc' });

      const result = await controller.list({ limit: 20 } as any, money);

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

      const result = await controller.findById('prod-1', money);

      expect(result).toEqual({ success: true, data: product });
      expect(service.findById).toHaveBeenCalledWith('prod-1');
    });
  });

  describe('findBySku', () => {
    it('should return success with product', async () => {
      const product = createMockProduct();
      service.findBySku.mockResolvedValue(product);

      const result = await controller.findBySku('SKU-001', money);

      expect(result).toEqual({ success: true, data: product });
      expect(service.findBySku).toHaveBeenCalledWith('SKU-001');
    });
  });

  describe('update', () => {
    it('should return success with updated product', async () => {
      const product = createMockProduct({ name: 'Updated' });
      service.update.mockResolvedValue(product);

      const result = await controller.update('prod-1', { name: 'Updated' } as any, user, money);

      expect(result).toEqual({ success: true, data: product });
      expect(service.update).toHaveBeenCalledWith('prod-1', { name: 'Updated' }, user);
    });
  });

  describe('archive', () => {
    it('should return success with archived product', async () => {
      const product = createMockProduct({ status: 'archived' as any });
      service.archive.mockResolvedValue(product);

      const result = await controller.archive('prod-1', user, money);

      expect(result).toEqual({ success: true, data: product });
      expect(service.archive).toHaveBeenCalledWith('prod-1', user);
    });
  });

  describe('reactivate', () => {
    it('should return success with the restored product', async () => {
      const product = createMockProduct();
      service.reactivate.mockResolvedValue(product);

      const result = await controller.reactivate('prod-1', user, money);

      expect(result).toEqual({ success: true, data: product });
      expect(service.reactivate).toHaveBeenCalledWith('prod-1', user);
    });
  });

  describe('importCsv', () => {
    it('should return success with import result', async () => {
      const importResult = { created: 2, updated: 1, errors: [] };
      service.importFromCsv.mockResolvedValue(importResult);
      const file = { buffer: Buffer.from('csv-data') } as Express.Multer.File;

      const result = await controller.importCsv(file, undefined, user);

      expect(result).toEqual({ success: true, data: importResult });
      expect(service.importFromCsv).toHaveBeenCalledWith(file.buffer, false, user);
    });

    it('should pass dryRun=true through when requested', async () => {
      service.importFromCsv.mockResolvedValue({ created: 0, updated: 0, errors: [] });
      const file = { buffer: Buffer.from('csv-data') } as Express.Multer.File;

      await controller.importCsv(file, '1', user);

      expect(service.importFromCsv).toHaveBeenCalledWith(file.buffer, true, user);
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

  describe('photo thumbnails', () => {
    const noMoney = { resolvedPermissions: createMockResolvedPermissions() };

    it("gives a list page's items their thumbnail URLs — after the money is taken out", async () => {
      const product = createMockProduct({ costCompany: 10 });
      service.list.mockResolvedValue({ items: [product], nextCursor: 'next' });
      thumbnails.withThumbnails.mockImplementation(async (items: any[]) =>
        items.map((i) => ({ ...i, thumbnailUrl: 'https://s3.test/thumb.webp' })),
      );

      const result = await controller.list({ limit: 20 } as any, noMoney);

      expect(thumbnails.withThumbnails.mock.calls[0][0][0]).not.toHaveProperty('costCompany');
      expect(result.data[0]).toMatchObject({ id: 'prod-1', thumbnailUrl: 'https://s3.test/thumb.webp' });
      expect(result.pagination).toEqual({ nextCursor: 'next', count: 1 });
    });

    it('completes an upload with the thumbnail step, answering the item', async () => {
      thumbnails.complete.mockResolvedValue({ ...createMockProduct(), thumbnailUrl: 'https://s3.test/t.webp' });

      const result = await controller.completePhotoUpload('prod-1', noMoney);

      expect(thumbnails.complete).toHaveBeenCalledWith('prod-1');
      expect(result.data).toMatchObject({ thumbnailUrl: 'https://s3.test/t.webp' });
      expect(result.data).not.toHaveProperty('costCompany');
    });

    it('removes the photo with its thumbnail', async () => {
      thumbnails.removePhoto.mockResolvedValue(createMockProduct());

      const result = await controller.removePhoto('prod-1', money);

      expect(thumbnails.removePhoto).toHaveBeenCalledWith('prod-1');
      expect(result.success).toBe(true);
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

  describe('listAllInternal', () => {
    it('should return success with { items, nextCursor } data', async () => {
      const product = createMockProduct();
      service.findAll.mockResolvedValue({ items: [product], nextCursor: 'abc' });

      const result = await controller.listAllInternal('50', 'cur');

      expect(result).toEqual({
        success: true,
        data: { items: [product], nextCursor: 'abc' },
      });
      expect(service.findAll).toHaveBeenCalledWith(50, 'cur');
    });

    it('should default limit to 200 when missing', async () => {
      service.findAll.mockResolvedValue({ items: [], nextCursor: undefined });

      await controller.listAllInternal(undefined, undefined);

      expect(service.findAll).toHaveBeenCalledWith(200, undefined);
    });

    it('should clamp limit to a max of 500', async () => {
      service.findAll.mockResolvedValue({ items: [], nextCursor: undefined });

      await controller.listAllInternal('9999');

      expect(service.findAll).toHaveBeenCalledWith(500, undefined);
    });
  });

  describe('findByIdInternal', () => {
    it('should return success with product', async () => {
      const product = createMockProduct();
      service.findById.mockResolvedValue(product);

      const result = await controller.findByIdInternal('prod-1');

      expect(result).toEqual({ success: true, data: product });
      expect(service.findById).toHaveBeenCalledWith('prod-1');
    });

    it('should throw NotFoundException when product is null', async () => {
      service.findById.mockResolvedValue(null);

      await expect(controller.findByIdInternal('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('count', () => {
    it('answers the list total in the envelope', async () => {
      service.count.mockResolvedValue({ total: 47, atLeast: false });

      expect(await controller.count({} as never)).toEqual({
        success: true,
        data: { total: 47, atLeast: false },
      });
    });

    it('passes the list filters through, so the number matches the rows', async () => {
      service.count.mockResolvedValue({ total: 9, atLeast: false });
      const query = { category: 'locks', status: 'active' };

      await controller.count(query as never);

      expect(service.count).toHaveBeenCalledWith(query);
    });
  });
});
