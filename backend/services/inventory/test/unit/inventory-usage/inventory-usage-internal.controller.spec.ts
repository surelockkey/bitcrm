import { IS_PUBLIC_KEY } from '@bitcrm/shared';
import { InventoryUsageInternalController } from 'src/inventory-usage/inventory-usage-internal.controller';
import { InternalGuard } from 'src/common/guards/internal.guard';
import { createMockInventoryUsageService } from '../mocks';

describe('InventoryUsageInternalController', () => {
  let service: ReturnType<typeof createMockInventoryUsageService>;
  let controller: InventoryUsageInternalController;

  beforeEach(() => {
    service = createMockInventoryUsageService();
    controller = new InventoryUsageInternalController(service as any);
  });

  it("re-files the job's usage rows and answers what moved", async () => {
    service.rekeyDeal.mockResolvedValue({ rows: 3, moved: 2, updated: 1 });
    const job = { dealNumber: 'K4T9ZW', scheduledDate: '2026-10-02' };

    expect(await controller.updateJob('deal-1', job as never)).toEqual({
      success: true,
      data: { rows: 3, moved: 2, updated: 1 },
    });
    expect(service.rekeyDeal).toHaveBeenCalledWith('deal-1', job);
  });

  /** Лише сервіс-сервіс: без x-internal-secret сюди не потрапити. */
  it('is an internal route — public to Cognito, behind the internal guard', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, controller.updateJob)).toBe(true);
    expect(Reflect.getMetadata('__guards__', controller.updateJob)).toEqual([InternalGuard]);
    expect(Reflect.getMetadata('path', controller.updateJob)).toBe('internal/deals/:dealId/job');
    expect(Reflect.getMetadata('path', InventoryUsageInternalController)).toBe('usage');
  });
});
