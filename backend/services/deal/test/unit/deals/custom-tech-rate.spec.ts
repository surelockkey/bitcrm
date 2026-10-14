import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createMockDeal, createMockJwtUser } from '../mocks';
import { buildLineItemsService } from './line-items.fixture';

/**
 * Workiz's "Commission rate" block on the job: Custom Tech Rate — this job
 * pays its technician a rate of its own (`%` of the split, or a fixed `$`)
 * instead of his settings'. Written on the job (`useTechSpecialRate`,
 * `techSpecialRate`, `techSpecialRateUnit`, the importer's names), read by
 * the commissions report, which takes it over the technician's rate and his
 * job-type rules while it is on. Workiz's "Override Rates" permission is
 * `commission.edit` here.
 */
describe('DealsService — Custom Tech Rate on a job', () => {
  let ctx: Awaited<ReturnType<typeof buildLineItemsService>>;
  const office = createMockJwtUser({ id: 'admin-1', roleId: 'role-admin' });
  const may = { mayOverrideRate: true };

  beforeEach(async () => {
    ctx = await buildLineItemsService();
    ctx.repo.findById.mockResolvedValue(createMockDeal({ id: 'deal-1' }));
    ctx.repo.update.mockImplementation(async (_id: string, u: Record<string, unknown>) => ({ ...createMockDeal({ id: 'deal-1' }), ...u }));
  });

  const written = () => ctx.repo.update.mock.calls[0][1];

  it('turns the rate on with a percentage', async () => {
    await ctx.service.update('deal-1', { useTechSpecialRate: true, techSpecialRate: 40, techSpecialRateUnit: '%' } as any, office, may);
    expect(written()).toMatchObject({ useTechSpecialRate: true, techSpecialRate: 40, techSpecialRateUnit: '%' });
  });

  it('a fixed dollar rate: unit "$"', async () => {
    await ctx.service.update('deal-1', { useTechSpecialRate: true, techSpecialRate: 120, techSpecialRateUnit: '$' } as any, office, may);
    expect(written()).toMatchObject({ useTechSpecialRate: true, techSpecialRate: 120, techSpecialRateUnit: '$' });
  });

  it('cannot be turned on without a rate — none sent, none stored', async () => {
    await expect(ctx.service.update('deal-1', { useTechSpecialRate: true } as any, office, may)).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.repo.update).not.toHaveBeenCalled();
  });

  it('can be turned on with the rate the job already holds', async () => {
    ctx.repo.findById.mockResolvedValue(createMockDeal({ id: 'deal-1', useTechSpecialRate: false, techSpecialRate: 35, techSpecialRateUnit: '%' }));
    await ctx.service.update('deal-1', { useTechSpecialRate: true } as any, office, may);
    expect(written()).toMatchObject({ useTechSpecialRate: true });
  });

  it('a percentage above 100 is refused', async () => {
    await expect(
      ctx.service.update('deal-1', { useTechSpecialRate: true, techSpecialRate: 120, techSpecialRateUnit: '%' } as any, office, may),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a rate sent without a unit is a percentage (Workiz "35")', async () => {
    await ctx.service.update('deal-1', { useTechSpecialRate: true, techSpecialRate: 35 } as any, office, may);
    expect(written()).toMatchObject({ useTechSpecialRate: true, techSpecialRate: 35, techSpecialRateUnit: '%' });
  });

  it('turning it off keeps the rate for next time', async () => {
    ctx.repo.findById.mockResolvedValue(createMockDeal({ id: 'deal-1', useTechSpecialRate: true, techSpecialRate: 40, techSpecialRateUnit: '%' }));
    await ctx.service.update('deal-1', { useTechSpecialRate: false } as any, office, may);
    expect(written()).toMatchObject({ useTechSpecialRate: false });
    expect(written()).not.toHaveProperty('techSpecialRate');
  });

  it('a null rate clears it and turns the override off', async () => {
    ctx.repo.findById.mockResolvedValue(createMockDeal({ id: 'deal-1', useTechSpecialRate: true, techSpecialRate: 40, techSpecialRateUnit: '%' }));
    await ctx.service.update('deal-1', { techSpecialRate: null } as any, office, may);
    expect(written()).toMatchObject({ useTechSpecialRate: false, techSpecialRate: null, techSpecialRateUnit: null });
  });

  it('needs commission.edit (Workiz "Override Rates"): 403 otherwise, nothing written', async () => {
    await expect(
      ctx.service.update('deal-1', { useTechSpecialRate: true, techSpecialRate: 40 } as any, office, { mayOverrideRate: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx.repo.update).not.toHaveBeenCalled();
  });

  it('an edit that leaves the rate alone needs no such right', async () => {
    await ctx.service.update('deal-1', { notes: 'x' } as any, office, { mayOverrideRate: false });
    expect(written()).toMatchObject({ notes: 'x' });
  });
});
