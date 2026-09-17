import { DealEventsHandler, DEAL_EVENT_TYPES } from 'src/deal-events/deal-events.handler';
import { OverdueSweepScheduler } from 'src/invoices/overdue-sweep.scheduler';

describe('DealEventsHandler', () => {
  const invoices = { refreshFromDeal: jest.fn(async () => undefined), deleteForDeal: jest.fn(async () => undefined) };
  const estimates = {
    archiveOpenForDeal: jest.fn(async () => 0),
    deleteForDeal: jest.fn(async () => undefined),
    followDealContact: jest.fn(async () => 0),
  };
  let handler: DealEventsHandler;
  const consumer = { registerHandler: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new DealEventsHandler(invoices as never, estimates as never, consumer as never);
  });

  it('registers every deal event it consumes', () => {
    process.env.BILLING_DEAL_EVENTS_QUEUE_URL = 'http://q';
    handler.onModuleInit();
    const types = consumer.registerHandler.mock.calls.map((c) => c[0]);
    expect(types.sort()).toEqual([...DEAL_EVENT_TYPES].sort());
    expect(types).toEqual(
      expect.arrayContaining([
        'deal.product_added',
        'deal.product_updated',
        'deal.product_removed',
        'deal.updated',
        'deal.status_changed',
        'deal.deleted',
      ]),
    );
    delete process.env.BILLING_DEAL_EVENTS_QUEUE_URL;
  });

  it.each(['deal.product_added', 'deal.product_updated', 'deal.product_removed', 'deal.updated'])(
    '%s refreshes the invoice snapshot',
    async (type) => {
      await handler.handle(type, { dealId: 'd1' });
      expect(invoices.refreshFromDeal).toHaveBeenCalledWith('d1');
      expect(estimates.archiveOpenForDeal).not.toHaveBeenCalled();
    },
  );

  it('deal.updated (e.g. the job moved to another client) re-points the estimates too', async () => {
    await handler.handle('deal.updated', { dealId: 'd1' });
    expect(estimates.followDealContact).toHaveBeenCalledWith('d1');
    await handler.handle('deal.product_added', { dealId: 'd1' });
    expect(estimates.followDealContact).toHaveBeenCalledTimes(1);
  });

  it('archives open estimates when the job is canceled', async () => {
    await handler.handle('deal.status_changed', { dealId: 'd1', oldStatus: 'submitted', newStatus: 'canceled' });
    expect(estimates.archiveOpenForDeal).toHaveBeenCalledWith('d1');
    expect(invoices.refreshFromDeal).toHaveBeenCalledWith('d1');
  });

  it('leaves estimates alone on other status changes', async () => {
    await handler.handle('deal.status_changed', { dealId: 'd1', newStatus: 'done' });
    expect(estimates.archiveOpenForDeal).not.toHaveBeenCalled();
  });

  it('deletes the invoice and estimates of a deleted job', async () => {
    await handler.handle('deal.deleted', { dealId: 'd1', deletedBy: 'u' });
    expect(invoices.deleteForDeal).toHaveBeenCalledWith('d1');
    expect(estimates.deleteForDeal).toHaveBeenCalledWith('d1');
  });

  it('ignores payloads without a dealId', async () => {
    await handler.handle('deal.updated', {});
    expect(invoices.refreshFromDeal).not.toHaveBeenCalled();
  });

  it('rethrows so SQS retries', async () => {
    invoices.refreshFromDeal.mockRejectedValueOnce(new Error('boom'));
    await expect(handler.handle('deal.updated', { dealId: 'd1' })).rejects.toThrow('boom');
  });
});

describe('OverdueSweepScheduler', () => {
  it('runs the sweep only when it wins the Redis lock', async () => {
    const invoices = { sweepOverdue: jest.fn(async () => 2) };
    const redis = { client: { set: jest.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null) } };
    const scheduler = new OverdueSweepScheduler(invoices as never, redis as never);
    await expect(scheduler.runOnce()).resolves.toBe(2);
    await expect(scheduler.runOnce()).resolves.toBeNull();
    expect(invoices.sweepOverdue).toHaveBeenCalledTimes(1);
    expect(redis.client.set).toHaveBeenCalledWith(expect.stringContaining('overdue'), expect.any(String), 'EX', expect.any(Number), 'NX');
  });
});
