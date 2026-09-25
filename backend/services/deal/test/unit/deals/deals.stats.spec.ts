import { BadRequestException } from '@nestjs/common';
import { JobSuperStatus } from '@bitcrm/types';
import { DealsService } from '../../../src/deals/deals.service';
import { createMockDeal, createMockDealsRepository, createMockJwtUser } from '../mocks';

function serviceWith(repo: ReturnType<typeof createMockDealsRepository>): DealsService {
  const stub = {} as any;
  return new DealsService(
    repo as any, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
  );
}

const money = (total: number) => ({ subtotal: total, discount: 0, tax: 0, total, cost: 0 });

describe('DealsService.stats', () => {
  const caller = createMockJwtUser({ id: 'u1' });

  it('reads the whole window through the list — every page — and aggregates it', async () => {
    const repo = createMockDealsRepository();
    repo.findByCreated
      .mockResolvedValueOnce({
        items: [createMockDeal({ id: 'a', createdAt: '2026-09-01T10:00:00.000Z', totals: money(10) })],
        nextCursor: 'next',
      })
      .mockResolvedValueOnce({
        items: [createMockDeal({ id: 'b', createdAt: '2026-09-02T10:00:00.000Z', totals: money(5) })],
      });

    const stats = await serviceWith(repo).stats(
      { createdFrom: '2026-09-01', createdTo: '2026-09-02' } as any,
      caller,
      'all',
      { money: true },
    );

    expect(repo.findByCreated).toHaveBeenCalledTimes(2);
    expect(repo.findByCreated.mock.calls[0][2]).toBe(100);
    expect(repo.findByCreated.mock.calls[1][3]).toBe('next');
    expect(stats.window).toEqual({ by: 'created', from: '2026-09-01', to: '2026-09-02' });
    expect(stats.jobs.total).toBe(2);
    expect(stats.money?.revenue).toBe(15);
  });

  it('takes the window a closed or scheduled report is on', async () => {
    const repo = createMockDealsRepository();
    repo.findByClosed.mockResolvedValue({
      items: [createMockDeal({ superStatus: JobSuperStatus.DONE, closedAt: '2026-09-03T08:00:00.000Z' })],
    });
    const stats = await serviceWith(repo).stats({ closedFrom: '2026-09-03' } as any, caller, 'all', { money: false });
    expect(stats.window).toEqual({ by: 'closed', from: '2026-09-03', to: '2026-09-03' });
    expect(stats.series).toEqual([{ date: '2026-09-03', jobs: 1 }]);
  });

  it('keeps an assigned-only caller to their own jobs', async () => {
    const repo = createMockDealsRepository();
    repo.findByCreated.mockResolvedValue({ items: [] });
    await serviceWith(repo).stats({ createdFrom: '2026-09-01' } as any, caller, 'assigned_only', { money: false });
    expect(repo.findByCreated.mock.calls[0][4]).toMatchObject({ techId: 'u1' });
  });

  it('refuses a request without a window — a period is the point', async () => {
    const repo = createMockDealsRepository();
    await expect(serviceWith(repo).stats({} as any, caller, 'all', { money: true })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
