import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InventoryStatus, type ProductCategory } from '@bitcrm/types';
import { ProductCategoriesService } from 'src/product-catalog/product-categories.service';
import { ProductCategoriesRepository } from 'src/product-catalog/product-categories.repository';

function category(overrides?: Partial<ProductCategory>): ProductCategory {
  return {
    id: 'cat-1',
    name: 'Locks & Cylinders',
    status: InventoryStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ProductCategoriesService', () => {
  let service: ProductCategoriesService;
  let repository: {
    create: jest.Mock; findById: jest.Mock; findAll: jest.Mock;
    findByName: jest.Mock; update: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      create: jest.fn(), findById: jest.fn(), findAll: jest.fn(),
      findByName: jest.fn(), update: jest.fn(),
    };
    repository.findByName.mockResolvedValue(null);
    repository.update.mockImplementation(async (id, attrs) => ({
      ...category({ id }), ...attrs,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductCategoriesService,
        { provide: ProductCategoriesRepository, useValue: repository },
      ],
    }).compile();

    service = module.get<ProductCategoriesService>(ProductCategoriesService);
  });

  describe('create', () => {
    it('rejects a duplicate name regardless of case', async () => {
      repository.findByName.mockResolvedValue(category());

      await expect(
        service.create({ name: 'locks & cylinders' }),
      ).rejects.toThrow(ConflictException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('rejects a parent that does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.create({ name: 'Deadbolts', parentId: 'ghost' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('nests under an existing parent', async () => {
      repository.findById.mockResolvedValue(category());

      const result = await service.create({ name: 'Deadbolts', parentId: 'cat-1' });

      expect(result.parentId).toBe('cat-1');
      expect(result.status).toBe(InventoryStatus.ACTIVE);
    });
  });

  describe('update', () => {
    it('refuses to make a category its own parent', async () => {
      repository.findById.mockResolvedValue(category());

      await expect(
        service.update('cat-1', { parentId: 'cat-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a parent that is one of its own descendants', async () => {
      // cat-1 -> cat-2 -> cat-3. Re-parenting cat-1 under cat-3 would orphan the tree.
      repository.findAll.mockResolvedValue([
        category({ id: 'cat-1' }),
        category({ id: 'cat-2', name: 'Deadbolts', parentId: 'cat-1' }),
        category({ id: 'cat-3', name: 'Euro', parentId: 'cat-2' }),
      ]);
      repository.findById.mockImplementation(async (id) =>
        id === 'cat-3' ? category({ id: 'cat-3', parentId: 'cat-2' }) : category(),
      );

      await expect(
        service.update('cat-1', { parentId: 'cat-3' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('archive', () => {
    beforeEach(() => {
      repository.findAll.mockResolvedValue([
        category({ id: 'cat-1' }),
        category({ id: 'cat-2', name: 'Deadbolts', parentId: 'cat-1' }),
        category({ id: 'cat-3', name: 'Euro', parentId: 'cat-2' }),
        category({ id: 'cat-9', name: 'Safes' }),
      ]);
    });

    it('cascades to every descendant, however deep', async () => {
      repository.findById.mockResolvedValue(category({ id: 'cat-1' }));

      const archived = await service.archive('cat-1');

      const touched = repository.update.mock.calls.map(([id]) => id).sort();
      expect(touched).toEqual(['cat-1', 'cat-2', 'cat-3']);
      expect(
        repository.update.mock.calls.every(
          ([, attrs]) => attrs.status === InventoryStatus.ARCHIVED,
        ),
      ).toBe(true);
      expect(archived).toHaveLength(3);
    });

    it('leaves unrelated branches alone', async () => {
      repository.findById.mockResolvedValue(category({ id: 'cat-1' }));

      await service.archive('cat-1');

      const touched = repository.update.mock.calls.map(([id]) => id);
      expect(touched).not.toContain('cat-9');
    });

    it('throws when the category is missing', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.archive('ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listWithCounts', () => {
    it('resolves the parent name for display', async () => {
      repository.findAll.mockResolvedValue([
        category({ id: 'cat-1' }),
        category({ id: 'cat-2', name: 'Deadbolts', parentId: 'cat-1' }),
      ]);

      const result = await service.listWithCounts();

      expect(result.find((c) => c.id === 'cat-2')?.parentName).toBe(
        'Locks & Cylinders',
      );
      expect(result.find((c) => c.id === 'cat-1')?.parentName).toBeUndefined();
    });
  });
});
