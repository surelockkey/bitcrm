import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { InventoryStatus, type Brand } from '@bitcrm/types';
import { BrandsService } from 'src/product-catalog/brands.service';
import { BrandsRepository } from 'src/product-catalog/brands.repository';

function brand(overrides?: Partial<Brand>): Brand {
  return {
    id: 'brand-1', name: 'SLK', status: InventoryStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('BrandsService', () => {
  let service: BrandsService;
  let repository: {
    create: jest.Mock; findById: jest.Mock; findAll: jest.Mock;
    findByName: jest.Mock; update: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      create: jest.fn(), findById: jest.fn(), findAll: jest.fn(),
      findByName: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockImplementation(async (id, attrs) => ({ ...brand({ id }), ...attrs })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrandsService,
        { provide: BrandsRepository, useValue: repository },
      ],
    }).compile();

    service = module.get<BrandsService>(BrandsService);
  });

  it('creates an active brand', async () => {
    const result = await service.create({ name: 'SLK' });

    expect(result.id).toBeDefined();
    expect(result.status).toBe(InventoryStatus.ACTIVE);
    expect(repository.create).toHaveBeenCalled();
  });

  it('rejects a duplicate name regardless of case', async () => {
    repository.findByName.mockResolvedValue(brand());

    await expect(service.create({ name: 'slk' })).rejects.toThrow(
      ConflictException,
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('trims the name before storing it', async () => {
    const result = await service.create({ name: '  SLK  ' });

    expect(result.name).toBe('SLK');
  });

  it('archives instead of deleting', async () => {
    repository.findById.mockResolvedValue(brand());

    const result = await service.archive('brand-1');

    expect(result.status).toBe(InventoryStatus.ARCHIVED);
  });

  it('throws when archiving a brand that does not exist', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.archive('ghost')).rejects.toThrow(NotFoundException);
  });

  it('allows renaming a brand to its own name', async () => {
    repository.findById.mockResolvedValue(brand());
    repository.findByName.mockResolvedValue(brand());

    await expect(
      service.update('brand-1', { name: 'SLK' }),
    ).resolves.toBeDefined();
  });
});
