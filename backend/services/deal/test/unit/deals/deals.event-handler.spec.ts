import { DealsEventHandler } from 'src/deals/deals.event-handler';

describe('DealsEventHandler', () => {
  let handler: DealsEventHandler;
  let service: Record<string, jest.Mock>;

  beforeEach(() => {
    service = {
      updatePaymentStatus: jest.fn().mockResolvedValue(undefined),
    };
    handler = new DealsEventHandler(service as any);
  });

  describe('handlePaymentReceived', () => {
    it('should call updatePaymentStatus', async () => {
      const payload = { dealId: 'deal-1', paymentId: 'pay-1', amount: 100, paidAt: '2026-04-20' };
      await handler.handlePaymentReceived(payload);

      expect(service.updatePaymentStatus).toHaveBeenCalledWith('deal-1', {
        paymentId: 'pay-1',
        amount: 100,
        paidAt: '2026-04-20',
      });
    });
  });

  describe('handleContactMerged', () => {
    it('should log and not throw', async () => {
      const payload = { oldContactId: 'old-1', newContactId: 'new-1' };
      await expect(handler.handleContactMerged(payload)).resolves.not.toThrow();
    });
  });
});
