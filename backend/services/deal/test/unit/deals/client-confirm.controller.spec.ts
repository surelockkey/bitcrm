import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IS_PUBLIC_KEY } from '@bitcrm/shared';
import { ClientConfirmController } from 'src/deals/client-confirm/client-confirm.controller';
import { ClientConfirmService } from 'src/deals/client-confirm/client-confirm.service';
import { ClientConfirmDto } from 'src/deals/client-confirm/dto/client-confirm.dto';

describe('ClientConfirmController — internal, for billing’s public confirm page (B12)', () => {
  let controller: ClientConfirmController;
  let service: { view: jest.Mock; confirm: jest.Mock };

  beforeEach(async () => {
    service = { view: jest.fn(), confirm: jest.fn() };
    const module = await Test.createTestingModule({
      controllers: [ClientConfirmController],
      providers: [{ provide: ClientConfirmService, useValue: service }],
    }).compile();
    controller = module.get(ClientConfirmController);
  });

  it('GET internal/:id/client-confirm answers the job as the page shows it', async () => {
    service.view.mockResolvedValue({ dealId: 'deal-1', state: 'open' });
    expect(await controller.view('deal-1')).toEqual({ success: true, data: { dealId: 'deal-1', state: 'open' } });
    expect(service.view).toHaveBeenCalledWith('deal-1');
  });

  it('POST internal/:id/client-confirm records the tap with how it came', async () => {
    service.confirm.mockResolvedValue({ dealId: 'deal-1', state: 'confirmed', recorded: true });
    const result = await controller.confirm('deal-1', { via: 'link', ip: '203.0.113.9', userAgent: 'Safari' });
    expect(result.data).toMatchObject({ state: 'confirmed', recorded: true });
    expect(service.confirm).toHaveBeenCalledWith('deal-1', { via: 'link', ip: '203.0.113.9', userAgent: 'Safari' });
  });

  it('both routes are internal (x-internal-secret), never open to the browser', () => {
    for (const handler of [ClientConfirmController.prototype.view, ClientConfirmController.prototype.confirm]) {
      // `@Internal()` = `@Public()` + InternalGuard: the metadata says public, the guard demands the secret.
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
      expect(Reflect.getMetadata('__guards__', handler)?.length).toBeGreaterThan(0);
    }
  });

  it('takes only a known channel and bounded client details', () => {
    const ok = validateSync(plainToInstance(ClientConfirmDto, { via: 'link', ip: '203.0.113.9', userAgent: 'x' }));
    expect(ok).toHaveLength(0);
    expect(validateSync(plainToInstance(ClientConfirmDto, { via: 'phone' }))).not.toHaveLength(0);
    expect(validateSync(plainToInstance(ClientConfirmDto, { via: 'link', userAgent: 'x'.repeat(513) }))).not.toHaveLength(0);
    expect(validateSync(plainToInstance(ClientConfirmDto, { via: 'link', ip: 'x'.repeat(65) }))).not.toHaveLength(0);
  });
});
