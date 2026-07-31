import { DealsEventHandler } from 'src/deals/deals.event-handler';

describe('DealsEventHandler', () => {
  let handler: DealsEventHandler;
  let service: Record<string, jest.Mock>;

  beforeEach(() => {
    service = {
      updatePaymentStatus: jest.fn().mockResolvedValue(undefined),
      reassignContact: jest.fn().mockResolvedValue(0),
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
    it('should re-point deals from the old contact to the new one', async () => {
      const payload = { oldContactId: 'old-1', newContactId: 'new-1' };
      service.reassignContact.mockResolvedValue(2);

      await handler.handleContactMerged(payload);

      expect(service.reassignContact).toHaveBeenCalledWith('old-1', 'new-1');
    });

    it('should rethrow when reassignment fails so SQS retries', async () => {
      service.reassignContact.mockRejectedValue(new Error('dynamo down'));

      await expect(
        handler.handleContactMerged({ oldContactId: 'old-1', newContactId: 'new-1' }),
      ).rejects.toThrow('dynamo down');
    });
  });
});
