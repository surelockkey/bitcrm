import { Test } from '@nestjs/testing';
import { DealsController } from 'src/deals/deals.controller';
import { DealsService } from 'src/deals/deals.service';
import { createMockDeal, createMockJwtUser } from '../mocks';

describe('DealsController — send to tech / seen', () => {
  let controller: DealsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      sendToTech: jest.fn(),
      markSeenByTech: jest.fn(),
      getAssignments: jest.fn(),
      recordSentToTechDelivery: jest.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [DealsController],
      providers: [{ provide: DealsService, useValue: service }],
    }).compile();
    controller = module.get(DealsController);
  });

  it('POST :id/send-to-tech hands the channels and roster subset to the service', async () => {
    const deal = createMockDeal({ sentToTechAt: '2026-04-16T10:00:00.000Z', sentToTechVia: ['sms'] });
    const caller = createMockJwtUser();
    service.sendToTech.mockResolvedValue(deal);

    const result = await controller.sendToTech('deal-1', { channels: ['sms'], techIds: ['tech-1'] }, caller);

    expect(result).toEqual({ success: true, data: deal });
    expect(service.sendToTech).toHaveBeenCalledWith('deal-1', { channels: ['sms'], techIds: ['tech-1'] }, caller);
  });

  it('POST :id/seen answers what the service decided', async () => {
    const caller = createMockJwtUser({ id: 'tech-1' });
    service.markSeenByTech.mockResolvedValue({ seen: true, seenAt: '2026-04-16T10:05:00.000Z', first: true });

    expect(await controller.markSeen('deal-1', caller)).toEqual({
      success: true,
      data: { seen: true, seenAt: '2026-04-16T10:05:00.000Z', first: true },
    });
    expect(service.markSeenByTech).toHaveBeenCalledWith('deal-1', caller);
  });

  it('GET :id/assignments lists the per-technician stamps', async () => {
    service.getAssignments.mockResolvedValue([{ dealId: 'deal-1', techId: 'tech-1', seenAt: 'x' }]);
    expect(await controller.getAssignments('deal-1')).toEqual({ success: true, data: [{ dealId: 'deal-1', techId: 'tech-1', seenAt: 'x' }] });
  });

  it('PUT internal/:id/sent-to-tech records a delivery report', async () => {
    service.recordSentToTechDelivery.mockResolvedValue({ recorded: true });
    const dto = { techId: 'tech-1', channel: 'sms' as const, status: 'sent' as const, sentAt: '2026-04-16T10:00:00.000Z', messageId: 'm1' };

    expect(await controller.recordSentToTech('deal-1', dto)).toEqual({ success: true, data: { recorded: true } });
    expect(service.recordSentToTechDelivery).toHaveBeenCalledWith('deal-1', dto);
  });
});
