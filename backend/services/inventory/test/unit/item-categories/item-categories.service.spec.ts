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

  describe('ensureCategory / ensureUncategorized', () => {
    it('creates the row when no category carries the name', async () => {
      repo.findByName.mockResolvedValue(null);

      const result = await service.ensureUncategorized();

      expect(result.created).toBe(true);
      expect(result.category).toMatchObject({ name: 'Uncategorized', active: true, createdBy: 'system' });
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Uncategorized' }));
      expect(repo.findByName).toHaveBeenCalledWith('Uncategorized');
      expect(publisher.publish).toHaveBeenCalledWith(
        'inventory-events',
        'item-category.created',
        expect.objectContaining({ name: 'Uncategorized' }),
      );
    });

    it('returns the existing row untouched (case-insensitive, even when archived)', async () => {
      const existing = createMockItemCategory({ id: 'cat-u', name: 'Uncategorized', active: false });
      repo.findByName.mockResolvedValue(existing);

      const result = await service.ensureCategory('uncategorized');

      expect(result).toEqual({ category: existing, created: false });
      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.put).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('re-reads instead of failing when a concurrent writer created the row first', async () => {
      const raced = createMockItemCategory({ id: 'cat-u', name: 'Uncategorized' });
      repo.findByName.mockResolvedValueOnce(null).mockResolvedValueOnce(raced);
      const err = new Error('The conditional request failed');
      err.name = 'ConditionalCheckFailedException';
      repo.create.mockRejectedValue(err);

      const result = await service.ensureUncategorized();

      expect(result).toEqual({ category: raced, created: false });
    });

    /**
     * The re-read above is only reachable if the two writers actually collide.
     * `create` guards with `attribute_not_exists(PK)` on `ITEM_CATEGORY#<id>`,
     * so a random id could never make the condition fire —
     * `UncategorizedCategorySeed` runs on every service instance, and the first
     * multi-task deploy after the import would seed N-1 duplicate
     * "Uncategorized" rows that nobody can then rename (409 on both).
     */
    it('derives the id from the name, so two instances aim at one row', async () => {
      const twinRepo = createMockCatalogRepository();
      const twin = new ItemCategoriesService(twinRepo as any, publisher as any);

      const mine = await service.ensureUncategorized();
      const theirs = await twin.ensureUncategorized();

      expect(mine.category.id).toBe(theirs.category.id);
      expect(repo.create.mock.calls[0][0].id).toBe(twinRepo.create.mock.calls[0][0].id);
      // Still a well-formed UUID (v5) — nothing downstream sees a new id shape.
      expect(mine.category.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('matches the id on the name alone — padding and casing do not fork it', async () => {
      const a = await service.ensureCategory('Locks');
      const b = await service.ensureCategory('  locks  ');

      expect(a.category.id).toBe(b.category.id);
    });

    it('gives different names different ids', async () => {
      const a = await service.ensureCategory('Locks');
      const b = await service.ensureCategory('Keys');

      expect(a.category.id).not.toBe(b.category.id);
    });

    it('falls back to a direct read when the index has not caught up', async () => {
      // findByName is a GSI query (eventually consistent), so the winner's row
      // can still be invisible there right after the race is lost.
      const winner = createMockItemCategory({ id: 'cat-u', name: 'Uncategorized' });
      const err = new Error('The conditional request failed');
      err.name = 'ConditionalCheckFailedException';
      repo.create.mockRejectedValue(err);
      repo.get.mockResolvedValue(winner);

      const result = await service.ensureUncategorized();

      expect(result).toEqual({ category: winner, created: false });
      expect(repo.get).toHaveBeenCalledWith(expect.any(String));
    });

    it('still rethrows when the row really is not there', async () => {
      repo.create.mockRejectedValue(new Error('boom'));
      repo.get.mockResolvedValue(null);

      await expect(service.ensureUncategorized()).rejects.toThrow('boom');
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
