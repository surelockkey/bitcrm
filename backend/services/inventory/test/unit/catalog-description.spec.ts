import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BrandsService } from 'src/brands/brands.service';
import { CreateBrandDto } from 'src/brands/dto/create-brand.dto';
import { UpdateBrandDto } from 'src/brands/dto/update-brand.dto';
import { ItemCategoriesService } from 'src/item-categories/item-categories.service';
import { CreateItemCategoryDto } from 'src/item-categories/dto/create-item-category.dto';
import { UpdateItemCategoryDto } from 'src/item-categories/dto/update-item-category.dto';
import {
  createMockBrand,
  createMockCatalogRepository,
  createMockItemCategory,
  createMockJwtUser,
} from './mocks';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (cls: any, payload: unknown) => plainToInstance(cls, payload) as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const errorsFor = async (cls: any, payload: unknown) =>
  (await validate(plainToInstance(cls, payload))).map((e) => e.property);

/**
 * Workiz's "Edit brand" and "Edit category" popups carry a description under
 * the name ("ALL ORDERS MADE BY SURE LOCK & KEY"). The import already writes
 * it on the rows; the API now takes it too, trimmed, '' clearing it.
 */
describe.each([
  ['CreateBrandDto', CreateBrandDto, { name: 'SLK' }],
  ['UpdateBrandDto', UpdateBrandDto, {}],
  ['CreateItemCategoryDto', CreateItemCategoryDto, { name: 'Locks' }],
  ['UpdateItemCategoryDto', UpdateItemCategoryDto, {}],
])('%s description', (_name, cls, base) => {
  it('accepts a description and trims it', async () => {
    const body = { ...base, description: '  All orders made by Sure Lock & Key  ' };
    expect(await errorsFor(cls, body)).toEqual([]);
    expect(parse(cls, body).description).toBe('All orders made by Sure Lock & Key');
  });

  it("accepts '' (clears it) and no description at all", async () => {
    expect(await errorsFor(cls, { ...base, description: '' })).toEqual([]);
    expect(await errorsFor(cls, base)).toEqual([]);
  });

  it('rejects a non-string and anything over 1000 characters', async () => {
    expect(await errorsFor(cls, { ...base, description: 7 })).toEqual(['description']);
    expect(await errorsFor(cls, { ...base, description: 'x'.repeat(1001) })).toEqual(['description']);
  });
});

describe('BrandsService description', () => {
  let repo: ReturnType<typeof createMockCatalogRepository>;
  let service: BrandsService;
  const caller = createMockJwtUser();

  beforeEach(() => {
    repo = createMockCatalogRepository();
    service = new BrandsService(repo as any, { publish: jest.fn().mockResolvedValue(undefined) } as any);
  });

  it('stores the description of a new brand', async () => {
    const brand = await service.create({ name: 'SLK', description: 'House brand' } as any, caller);
    expect(brand).toMatchObject({ name: 'SLK', description: 'House brand' });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ description: 'House brand' }));
  });

  it('leaves a new brand without a description when none is sent', async () => {
    const brand = await service.create({ name: 'SLK' } as any, caller);
    expect(brand).not.toHaveProperty('description');
  });

  it('changes, clears or keeps the description on update', async () => {
    repo.get.mockResolvedValue({ ...createMockBrand({ id: 'b1', name: 'SLK' }), description: 'Old' });
    expect(await service.update('b1', { description: 'New' } as any, caller)).toMatchObject({ description: 'New' });
    expect(repo.put).toHaveBeenLastCalledWith(expect.objectContaining({ description: 'New' }));

    expect(await service.update('b1', { description: '' } as any, caller)).toMatchObject({ description: '' });

    expect(await service.update('b1', { active: false } as any, caller)).toMatchObject({ description: 'Old' });
  });
});

describe('ItemCategoriesService description', () => {
  let repo: ReturnType<typeof createMockCatalogRepository>;
  let service: ItemCategoriesService;
  const caller = createMockJwtUser();

  beforeEach(() => {
    repo = createMockCatalogRepository();
    service = new ItemCategoriesService(
      repo as any,
      { move: jest.fn().mockResolvedValue(0) } as any,
      { publish: jest.fn().mockResolvedValue(undefined) } as any,
    );
  });

  it('stores the description of a new category', async () => {
    const category = await service.create({ name: 'Locks', description: 'Cylinders and more' } as any, caller);
    expect(category).toMatchObject({ name: 'Locks', description: 'Cylinders and more' });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ description: 'Cylinders and more' }));
  });

  it('changes, clears or keeps the description on update, the imported fields untouched', async () => {
    repo.get.mockResolvedValue({
      ...createMockItemCategory({ id: 'c1', name: 'Locks' }),
      description: 'Old',
      parentId: 'p1',
      workizFilePath: 'https://example.test/a.png',
    });
    const updated = await service.update('c1', { description: 'New' } as any, caller);
    expect(updated).toMatchObject({ description: 'New', parentId: 'p1', workizFilePath: 'https://example.test/a.png' });

    expect(await service.update('c1', { description: '' } as any, caller)).toMatchObject({ description: '' });
    expect(await service.update('c1', { active: false } as any, caller)).toMatchObject({ description: 'Old' });
  });
});
