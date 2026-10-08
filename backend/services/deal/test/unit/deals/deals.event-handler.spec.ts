import { DealsEventHandler } from 'src/deals/deals.event-handler';

describe('DealsEventHandler', () => {
  let handler: DealsEventHandler;
  let service: Record<string, jest.Mock>;

  beforeEach(() => {
    service = {
      updatePaymentStatus: jest.fn().mockResolvedValue(undefined),
      reassignContact: jest.fn().mockResolvedValue(0),
      refreshClientSearch: jest.fn().mockResolvedValue(0),
    };
    handler = new DealsEventHandler(service as any);
  });

  it('no longer handles payment.received — billing calls the internal endpoint directly', () => {
    // No queue ever carried `payment.received` and nothing published it; the
    // payment ledger lives in billing-service and pushes the job's flag over
    // `PUT /api/deals/internal/:id/payment-status`.
    expect((handler as unknown as Record<string, unknown>).handlePaymentReceived).toBeUndefined();
  });

  describe('handleContactUpdated', () => {
    // crm says only `{contactId}`; the jobs list's Search box matches the
    // client's name, numbers and emails, kept on each of their jobs.
    it('restamps the client’s half of the search on every job of the client', async () => {
      service.refreshClientSearch.mockResolvedValue(3);

      await handler.handleContactUpdated({ contactId: 'c-1' });

      expect(service.refreshClientSearch).toHaveBeenCalledWith('c-1');
    });

    it('rethrows so SQS delivers it again when crm or DynamoDB fails', async () => {
      service.refreshClientSearch.mockRejectedValue(new Error('crm down'));
      await expect(handler.handleContactUpdated({ contactId: 'c-1' })).rejects.toThrow('crm down');
    });

    it('ignores a payload without a contact', async () => {
      await handler.handleContactUpdated({});
      expect(service.refreshClientSearch).not.toHaveBeenCalled();
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
