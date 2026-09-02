import { ConflictException, NotFoundException } from '@nestjs/common';
import { ItemCategoriesService } from 'src/item-categories/item-categories.service';
import {
  createMockCatalogRepository,
  createMockItemCategory,
  createMockJwtUser,
} from '../mocks';

describe('ItemCategoriesService', () => {
  let repo: ReturnType<typeof createMockCatalogRepository>;
  let publisher: { publish: jest.Mock };
  let service: ItemCategoriesService;
  const caller = createMockJwtUser();

  beforeEach(() => {
    repo = createMockCatalogRepository();
    publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    service = new ItemCategoriesService(repo as any, publisher as any);
  });

  describe('create', () => {
    it('persists a new category (active by default) and emits an event', async () => {
      const category = await service.create({ name: 'Locks' } as any, caller);

      expect(category).toMatchObject({ name: 'Locks', active: true, createdBy: caller.id });
      expect(category.id).toBeDefined();
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Locks' }));
      expect(publisher.publish).toHaveBeenCalledWith(
        'inventory-events',
        'item-category.created',
        expect.any(Object),
      );
    });

    it('rejects a duplicate name (case-insensitive) with 409', async () => {
      repo.listAll.mockResolvedValue([createMockItemCategory({ name: 'Locks' })]);
      await expect(service.create({ name: '  locks ' } as any, caller)).rejects.toThrow(
        ConflictException,
      );
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('sorts alphabetically by name', async () => {
      repo.listAll.mockResolvedValue([
        createMockItemCategory({ id: 'b', name: 'Tools' }),
        createMockItemCategory({ id: 'a', name: 'Keys' }),
      ]);
      const list = await service.list();
      expect(list.map((c) => c.name)).toEqual(['Keys', 'Tools']);
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
      repo.get.mockResolvedValue(createMockItemCategory({ id: 'cat-1', name: 'Locks' }));
      repo.listAll.mockResolvedValue([
        createMockItemCategory({ id: 'cat-1', name: 'Locks' }),
        createMockItemCategory({ id: 'cat-2', name: 'Keys' }),
      ]);
      await expect(service.update('cat-1', { name: 'Keys' } as any, caller)).rejects.toThrow(
        ConflictException,
      );
    });

    it('allows keeping the same name and toggling active', async () => {
      repo.get.mockResolvedValue(createMockItemCategory({ id: 'cat-1', name: 'Locks' }));
      repo.listAll.mockResolvedValue([createMockItemCategory({ id: 'cat-1', name: 'Locks' })]);

      const updated = await service.update('cat-1', { name: 'Locks', active: false } as any, caller);

      expect(updated.active).toBe(false);
      expect(repo.put).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('archives a category still referenced by an item', async () => {
      repo.get.mockResolvedValue(createMockItemCategory({ id: 'cat-1', name: 'Locks', active: true }));
      repo.isReferencedByProduct.mockResolvedValue(true);

      const result = await service.remove('cat-1', caller);

      expect(result).toEqual({ archived: true });
      expect(repo.remove).not.toHaveBeenCalled();
      expect(repo.put).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
      expect(repo.isReferencedByProduct).toHaveBeenCalledWith('Locks');
    });

    it('deletes an unreferenced category outright', async () => {
      repo.get.mockResolvedValue(createMockItemCategory({ id: 'cat-1' }));
      repo.isReferencedByProduct.mockResolvedValue(false);

      const result = await service.remove('cat-1', caller);

      expect(result).toEqual({ archived: false });
      expect(repo.remove).toHaveBeenCalledWith('cat-1');
    });
  });
});
