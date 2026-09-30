import { ConflictException, NotFoundException } from '@nestjs/common';
import { BrandsService } from 'src/brands/brands.service';
import {
  createMockCatalogRepository,
  createMockBrand,
  createMockJwtUser,
} from '../mocks';

describe('BrandsService', () => {
  let repo: ReturnType<typeof createMockCatalogRepository>;
  let publisher: { publish: jest.Mock };
  let service: BrandsService;
  const caller = createMockJwtUser();

  beforeEach(() => {
    repo = createMockCatalogRepository();
    publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    service = new BrandsService(repo as any, publisher as any);
  });

  describe('create', () => {
    it('persists a new brand (active by default) and emits an event', async () => {
      const brand = await service.create({ name: 'Schlage' } as any, caller);

      expect(brand).toMatchObject({ name: 'Schlage', active: true, createdBy: caller.id });
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Schlage' }));
      expect(publisher.publish).toHaveBeenCalledWith(
        'inventory-events',
        'brand.created',
        expect.any(Object),
      );
    });

    it('rejects a duplicate name (case-insensitive) with 409', async () => {
      repo.listAll.mockResolvedValue([createMockBrand({ name: 'Schlage' })]);
      await expect(service.create({ name: 'SCHLAGE' } as any, caller)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('list', () => {
    it('sorts alphabetically by name', async () => {
      repo.listAll.mockResolvedValue([
        createMockBrand({ id: 'b', name: 'Yale' }),
        createMockBrand({ id: 'a', name: 'Kwikset' }),
      ]);
      const list = await service.list();
      expect(list.map((b) => b.name)).toEqual(['Kwikset', 'Yale']);
    });
  });

  describe('findById', () => {
    it('throws 404 when missing', async () => {
      repo.get.mockResolvedValue(null);
      await expect(service.findById('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('re-checks name uniqueness when renaming', async () => {
      repo.get.mockResolvedValue(createMockBrand({ id: 'brand-1', name: 'Schlage' }));
      repo.listAll.mockResolvedValue([
        createMockBrand({ id: 'brand-1', name: 'Schlage' }),
        createMockBrand({ id: 'brand-2', name: 'Yale' }),
      ]);
      await expect(service.update('brand-1', { name: 'Yale' } as any, caller)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  /** Товари несуть `brandId`, тож бренд у вжитку архівується, як категорія. */
  describe('remove', () => {
    it('archives a brand still used by an item instead of deleting it', async () => {
      repo.get.mockResolvedValue(createMockBrand({ id: 'brand-1', active: true }));
      repo.isReferencedByProduct.mockResolvedValue(true);

      const result = await service.remove('brand-1', caller);

      expect(result).toEqual({ archived: true });
      expect(repo.isReferencedByProduct).toHaveBeenCalledWith('brand-1');
      expect(repo.remove).not.toHaveBeenCalled();
      expect(repo.put).toHaveBeenCalledWith(expect.objectContaining({ id: 'brand-1', active: false }));
      expect(publisher.publish).toHaveBeenCalledWith(
        'inventory-events',
        'brand.archived',
        expect.objectContaining({ brandId: 'brand-1', archivedBy: caller.id }),
      );
    });

    it('leaves an already archived brand in use as it is', async () => {
      repo.get.mockResolvedValue(createMockBrand({ id: 'brand-1', active: false }));
      repo.isReferencedByProduct.mockResolvedValue(true);

      expect(await service.remove('brand-1', caller)).toEqual({ archived: true });
      expect(repo.put).not.toHaveBeenCalled();
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it('deletes a brand no item uses outright', async () => {
      repo.get.mockResolvedValue(createMockBrand({ id: 'brand-1' }));
      repo.isReferencedByProduct.mockResolvedValue(false);

      const result = await service.remove('brand-1', caller);

      expect(result).toEqual({ archived: false });
      expect(repo.remove).toHaveBeenCalledWith('brand-1');
      expect(repo.put).not.toHaveBeenCalled();
      expect(publisher.publish).toHaveBeenCalledWith(
        'inventory-events',
        'brand.deleted',
        expect.any(Object),
      );
    });
  });
});
