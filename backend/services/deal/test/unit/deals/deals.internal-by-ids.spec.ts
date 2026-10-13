/**
 * K1 — `POST /api/deals/internal/by-ids` (billing): `{ ids }` → `Deal[]`,
 * service-to-service only, at most 500 ids.
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RequestMethod } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '@bitcrm/shared';
import { DealsController } from '../../../src/deals/deals.controller';
import { InternalDealsByIdsDto } from '../../../src/deals/dto/deals-by-ids.dto';
import { InternalGuard } from '../../../src/common/guards/internal.guard';
import { createMockDeal } from '../mocks';

describe('POST /deals/internal/by-ids', () => {
  const handler = DealsController.prototype.findByIdsInternal;

  it('is a POST on internal/by-ids, @Internal (public to Cognito, guarded by the shared secret)', () => {
    expect(Reflect.getMetadata('path', handler)).toBe('internal/by-ids');
    expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata('__guards__', handler)).toContain(InternalGuard);
  });

  it('answers 200 with the deals in the envelope', async () => {
    const service = { findByIdsInternal: jest.fn().mockResolvedValue([createMockDeal({ id: 'a' })]) };
    const controller = new DealsController(service as never);
    expect(Reflect.getMetadata('__httpCode__', handler)).toBe(200);
    const res = await controller.findByIdsInternal({ ids: ['a', 'b'] });
    expect(service.findByIdsInternal).toHaveBeenCalledWith(['a', 'b']);
    expect(res).toEqual({ success: true, data: [createMockDeal({ id: 'a' })] });
  });

  it('takes up to 500 string ids; more, or not strings, is a 400 (validation)', async () => {
    const ok = plainToInstance(InternalDealsByIdsDto, { ids: Array.from({ length: 500 }, (_, i) => `d${i}`) });
    expect(await validate(ok)).toHaveLength(0);
    const tooMany = plainToInstance(InternalDealsByIdsDto, { ids: Array.from({ length: 501 }, (_, i) => `d${i}`) });
    expect((await validate(tooMany)).length).toBeGreaterThan(0);
    const wrong = plainToInstance(InternalDealsByIdsDto, { ids: [1, 2] });
    expect((await validate(wrong)).length).toBeGreaterThan(0);
    const missing = plainToInstance(InternalDealsByIdsDto, {});
    expect((await validate(missing)).length).toBeGreaterThan(0);
  });

  it('is declared before every `internal/:id` route of the controller', () => {
    const names = Object.getOwnPropertyNames(DealsController.prototype);
    const at = (path: string) =>
      names.findIndex((n) => Reflect.getMetadata('path', (DealsController.prototype as any)[n]) === path);
    expect(at('internal/by-ids')).toBeGreaterThanOrEqual(0);
    expect(at('internal/by-ids')).toBeLessThan(at('internal/:id'));
  });
});
