import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RedisService } from '@bitcrm/shared';
import { ProductsService } from 'src/products/products.service';
import { ProductsCacheService } from 'src/products/products-cache.service';
import { ProductsByIdsDto } from 'src/products/dto/products-by-ids.dto';
import { ProductsController } from 'src/products/products.controller';
import { createMockProduct, createMockProductsRepository } from '../mocks';

/**
 * Contract C2 — `POST /products/internal/by-ids`: many products in one call,
 * the same shape as `GET /products/internal/:id`, missing ids left out.
 * Read-through the per-product Redis cache: hits from MGET, misses from one
 * BatchGet (chunks of 100), then cached.
 */
describe('ProductsService.findByIdsInternal (C2)', () => {
  let repository: ReturnType<typeof createMockProductsRepository>;
  let cache: { getMany: jest.Mock; setMany: jest.Mock };
  let service: ProductsService;

  beforeEach(() => {
    repository = createMockProductsRepository();
    cache = { getMany: jest.fn(async () => new Map()), setMany: jest.fn(async () => undefined) };
    service = new ProductsService(repository as never, cache as never, undefined as never, undefined as never);
  });

  it('answers hits from the cache and batch-loads only the misses, in request order', async () => {
    const a = createMockProduct({ id: 'a', name: 'A' });
    const b = createMockProduct({ id: 'b', name: 'B' });
    cache.getMany.mockResolvedValue(new Map([['b', b]]));
    repository.findByIds.mockResolvedValue([a]);

    const out = await service.findByIdsInternal(['a', 'b', 'a', 'ghost']);

    expect(cache.getMany).toHaveBeenCalledWith(['a', 'b', 'ghost']);
    expect(repository.findByIds).toHaveBeenCalledWith(['a', 'ghost']);
    expect(cache.setMany).toHaveBeenCalledWith([a]);
    expect(out.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('does not touch DynamoDB when every id is cached', async () => {
    const a = createMockProduct({ id: 'a' });
    cache.getMany.mockResolvedValue(new Map([['a', a]]));
    await expect(service.findByIdsInternal(['a'])).resolves.toEqual([a]);
    expect(repository.findByIds).not.toHaveBeenCalled();
  });

  it('works with Redis down', async () => {
    const a = createMockProduct({ id: 'a' });
    cache.getMany.mockRejectedValue(new Error('down'));
    cache.setMany.mockRejectedValue(new Error('down'));
    repository.findByIds.mockResolvedValue([a]);
    await expect(service.findByIdsInternal(['a'])).resolves.toEqual([a]);
  });

  it('an empty list is an empty answer', async () => {
    await expect(service.findByIdsInternal([])).resolves.toEqual([]);
    expect(repository.findByIds).not.toHaveBeenCalled();
  });

  it('rejects more than 500 distinct ids with 400 (after dedupe)', async () => {
    const many = Array.from({ length: 501 }, (_, i) => `p-${i}`);
    await expect(service.findByIdsInternal(many)).rejects.toThrow(BadRequestException);
    // 600 entries that dedupe to 300 are fine.
    const dupes = [...Array.from({ length: 300 }, (_, i) => `p-${i}`), ...Array.from({ length: 300 }, (_, i) => `p-${i}`)];
    await expect(service.findByIdsInternal(dupes)).resolves.toEqual([]);
  });
});

describe('ProductsCacheService — many at once', () => {
  it('getMany reads every key in one MGET and parses the hits', async () => {
    const a = createMockProduct({ id: 'a' });
    const client = { mget: jest.fn(async () => [JSON.stringify(a), null]), set: jest.fn() };
    const cache = new ProductsCacheService({ client } as unknown as RedisService);

    const hits = await cache.getMany(['a', 'b']);

    expect(client.mget).toHaveBeenCalledWith('inventory:product:a', 'inventory:product:b');
    expect([...hits.keys()]).toEqual(['a']);
    expect(hits.get('a')).toEqual(a);
  });

  it('getMany of nothing asks Redis nothing', async () => {
    const client = { mget: jest.fn() };
    const cache = new ProductsCacheService({ client } as unknown as RedisService);
    expect((await cache.getMany([])).size).toBe(0);
    expect(client.mget).not.toHaveBeenCalled();
  });

  it('setMany writes each product with the 5-minute TTL', async () => {
    const a = createMockProduct({ id: 'a' });
    const client = { set: jest.fn(async () => 'OK') };
    const cache = new ProductsCacheService({ client } as unknown as RedisService);
    await cache.setMany([a]);
    expect(client.set).toHaveBeenCalledWith('inventory:product:a', JSON.stringify(a), 'EX', 300);
  });
});

describe('ProductsByIdsDto', () => {
  const errorsFor = async (payload: unknown) =>
    (await validate(plainToInstance(ProductsByIdsDto, payload))).map((e) => e.property);

  it('takes a list of ids', async () => {
    expect(await errorsFor({ ids: ['a', 'b'] })).toEqual([]);
    expect(await errorsFor({ ids: [] })).toEqual([]);
  });

  it('refuses anything that is not a list of strings', async () => {
    expect(await errorsFor({})).toEqual(['ids']);
    expect(await errorsFor({ ids: 'a' })).toEqual(['ids']);
    expect(await errorsFor({ ids: [1, 2] })).toEqual(['ids']);
  });
});

describe('ProductsController.findByIdsInternal', () => {
  it('wraps the products in the envelope, unstripped (internal read)', async () => {
    const p = createMockProduct({ id: 'a' });
    const products = { findByIdsInternal: jest.fn(async () => [p]) };
    const controller = new ProductsController(products as never, {} as never);

    await expect(controller.findByIdsInternal({ ids: ['a'] })).resolves.toEqual({ success: true, data: [p] });
    expect(products.findByIdsInternal).toHaveBeenCalledWith(['a']);
  });
});
