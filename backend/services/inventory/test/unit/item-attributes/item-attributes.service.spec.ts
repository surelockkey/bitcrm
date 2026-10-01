import { ConflictException, NotFoundException } from '@nestjs/common';
import { type ItemAttribute } from '@bitcrm/types';
import { ItemAttributesService, sortItemAttributes } from 'src/item-attributes/item-attributes.service';
import { createMockJwtUser, createMockProductsCacheService } from '../mocks';

function attribute(over: Partial<ItemAttribute> = {}): ItemAttribute {
  return { id: 'attr-1', name: 'Link_UHS', type: 'text', visible: false, resource: 'items', ...over };
}

function createRepository() {
  return {
    listAll: jest.fn().mockResolvedValue([]),
    get: jest.fn(),
    create: jest.fn(),
    put: jest.fn(),
    remove: jest.fn(),
    forEachProductWithAttribute: jest.fn().mockResolvedValue(0),
    renameProductValue: jest.fn().mockResolvedValue(true),
    removeProductValue: jest.fn().mockResolvedValue(true),
  };
}

/** Hands the walk the given pages, the way the repository would. */
function productsHolding(repo: ReturnType<typeof createRepository>, ...pages: string[][]) {
  repo.forEachProductWithAttribute.mockImplementation(async (_name, onPage) => {
    for (const ids of pages) await onPage(ids.map((id) => ({ id, customAttributes: {} })));
    return pages.flat().length;
  });
}

describe('ItemAttributesService', () => {
  let repo: ReturnType<typeof createRepository>;
  let cache: ReturnType<typeof createMockProductsCacheService>;
  let publisher: { publish: jest.Mock };
  let service: ItemAttributesService;
  const caller = createMockJwtUser();

  beforeEach(() => {
    repo = createRepository();
    cache = createMockProductsCacheService();
    publisher = { publish: jest.fn().mockResolvedValue(undefined) };
    service = new ItemAttributesService(repo as any, cache as any, publisher as any);
  });

  describe('list', () => {
    it('keeps the Workiz order: imported fields by Workiz id, then new ones by creation time', async () => {
      repo.listAll.mockResolvedValue([
        attribute({ id: 'n2', name: 'Zeta', createdAt: '2026-09-30T10:00:00Z' }),
        attribute({ id: 'w3', name: 'LINK_PHOTOS', externalId: 'workiz:attribute:9000' }),
        attribute({ id: 'n1', name: 'Alpha', createdAt: '2026-09-30T09:00:00Z' }),
        attribute({ id: 'w1', name: 'ALL SKU', externalId: 'workiz:attribute:5297' }),
        attribute({ id: 'w2', name: 'In Store Location', externalId: 'workiz:attribute:5588' }),
      ]);

      const list = await service.list();

      expect(list.map((a) => a.name)).toEqual([
        'ALL SKU',
        'In Store Location',
        'LINK_PHOTOS',
        'Alpha',
        'Zeta',
      ]);
    });

    it('sortItemAttributes() does not mutate its input', () => {
      const input = [attribute({ id: 'b', name: 'B' }), attribute({ id: 'a', name: 'A' })];
      sortItemAttributes(input);
      expect(input.map((a) => a.id)).toEqual(['b', 'a']);
    });
  });

  describe('create', () => {
    it('stores a trimmed name, text / hidden by default, for the item resource', async () => {
      const created = await service.create({ name: '  Bin  ' } as any, caller);

      expect(created).toMatchObject({
        name: 'Bin',
        type: 'text',
        visible: false,
        resource: 'items',
        createdBy: caller.id,
      });
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Bin' }));
      expect(publisher.publish).toHaveBeenCalledWith(
        'inventory-events',
        'item-attribute.created',
        expect.objectContaining({ name: 'Bin' }),
      );
    });

    it('keeps the type and visibility it is given', async () => {
      const created = await service.create({ name: 'Qty', type: 'quantity', visible: true } as any, caller);
      expect(created).toMatchObject({ type: 'quantity', visible: true });
    });

    it('rejects a name already taken, case-insensitively, with the Workiz message', async () => {
      repo.listAll.mockResolvedValue([attribute({ name: 'Link_UHS' })]);

      await expect(service.create({ name: 'LINK_uhs' } as any, caller)).rejects.toThrow(
        new ConflictException('Name is in use, please pick a different one'),
      );
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('404s an unknown id', async () => {
      repo.get.mockResolvedValue(null);
      await expect(service.update('nope', { visible: true } as any, caller)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('a rename moves the value on every item holding it, then stores the new name', async () => {
      repo.get.mockResolvedValue(attribute({ name: 'Link_UHS' }));
      repo.listAll.mockResolvedValue([attribute({ name: 'Link_UHS' })]);
      productsHolding(repo, ['p1', 'p2'], ['p3']);
      const order: string[] = [];
      repo.renameProductValue.mockImplementation(async (id) => {
        order.push(`move ${id}`);
        return true;
      });
      repo.put.mockImplementation(async () => {
        order.push('put');
      });

      const result = await service.update('attr-1', { name: 'UHS link' } as any, caller);

      expect(repo.forEachProductWithAttribute).toHaveBeenCalledWith('Link_UHS', expect.any(Function));
      expect(repo.renameProductValue.mock.calls).toEqual([
        ['p1', 'Link_UHS', 'UHS link'],
        ['p2', 'Link_UHS', 'UHS link'],
        ['p3', 'Link_UHS', 'UHS link'],
      ]);
      // Items first, the definition last: a rename cut short is finished by resending it.
      expect(order[order.length - 1]).toBe('put');
      expect(repo.put).toHaveBeenCalledWith(expect.objectContaining({ id: 'attr-1', name: 'UHS link' }));
      expect(cache.invalidate.mock.calls.map(([id]) => id).sort()).toEqual(['p1', 'p2', 'p3']);
      expect(result).toMatchObject({ name: 'UHS link', productsUpdated: 3, productsSkipped: 0 });
    });

    it('counts an item that already had a value under the new name as skipped (kept, not overwritten)', async () => {
      repo.get.mockResolvedValue(attribute({ name: 'A' }));
      productsHolding(repo, ['p1', 'p2']);
      repo.renameProductValue.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      const result = await service.update('attr-1', { name: 'B' } as any, caller);

      expect(result).toMatchObject({ productsUpdated: 1, productsSkipped: 1 });
      expect(cache.invalidate).toHaveBeenCalledTimes(1);
    });

    it('a case-only rename is a rename (the key is matched exactly)', async () => {
      repo.get.mockResolvedValue(attribute({ name: 'sku_crm' }));
      repo.listAll.mockResolvedValue([attribute({ name: 'sku_crm' })]);
      productsHolding(repo, ['p1']);

      await service.update('attr-1', { name: 'SKU_CRM' } as any, caller);

      expect(repo.renameProductValue).toHaveBeenCalledWith('p1', 'sku_crm', 'SKU_CRM');
    });

    it('rejects renaming onto another field name (409) and touches no item', async () => {
      repo.get.mockResolvedValue(attribute({ id: 'attr-1', name: 'A' }));
      repo.listAll.mockResolvedValue([
        attribute({ id: 'attr-1', name: 'A' }),
        attribute({ id: 'attr-2', name: 'SKU_UHS' }),
      ]);

      await expect(service.update('attr-1', { name: 'sku_uhs' } as any, caller)).rejects.toThrow(
        ConflictException,
      );
      expect(repo.forEachProductWithAttribute).not.toHaveBeenCalled();
      expect(repo.put).not.toHaveBeenCalled();
    });

    it('a visibility or type change alone walks no item', async () => {
      repo.get.mockResolvedValue(attribute({ name: 'A', visible: false }));

      const result = await service.update('attr-1', { name: 'A', visible: true, type: 'number' } as any, caller);

      expect(repo.forEachProductWithAttribute).not.toHaveBeenCalled();
      expect(repo.put).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'A', visible: true, type: 'number' }),
      );
      expect(result).toMatchObject({ productsUpdated: 0 });
    });
  });

  describe('remove', () => {
    it('removes the value from every item, then the definition', async () => {
      repo.get.mockResolvedValue(attribute({ name: 'SKU_CRM' }));
      productsHolding(repo, ['p1', 'p2']);
      const order: string[] = [];
      repo.removeProductValue.mockImplementation(async (id) => {
        order.push(`strip ${id}`);
        return true;
      });
      repo.remove.mockImplementation(async () => {
        order.push('remove');
      });

      const result = await service.remove('attr-1', caller);

      expect(repo.removeProductValue.mock.calls).toEqual([
        ['p1', 'SKU_CRM'],
        ['p2', 'SKU_CRM'],
      ]);
      expect(order).toEqual(['strip p1', 'strip p2', 'remove']);
      expect(result).toEqual({ productsUpdated: 2, productsSkipped: 0 });
      expect(publisher.publish).toHaveBeenCalledWith(
        'inventory-events',
        'item-attribute.deleted',
        expect.objectContaining({ attributeId: 'attr-1', name: 'SKU_CRM' }),
      );
    });

    it('404s an unknown id and deletes nothing', async () => {
      repo.get.mockResolvedValue(null);
      await expect(service.remove('nope', caller)).rejects.toThrow(NotFoundException);
      expect(repo.remove).not.toHaveBeenCalled();
    });
  });
});
