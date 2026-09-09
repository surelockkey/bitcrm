import { IndexerEventHandler } from 'src/indexer/indexer.event-handler';
import { UnsupportedEntityError } from 'src/indexer/entity-fetcher.service';

/**
 * onDelete had no instrumentation at all, so index removals were invisible in
 * Grafana even once search-service started being scraped.
 */
function makeDeps() {
  const indexer = {
    indexEntity: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    findDealIdsBy: jest.fn().mockResolvedValue([]),
  };
  const fetcher = { fetch: jest.fn().mockResolvedValue({ id: 'x' }) };
  const catalogNames = { invalidateCustomFields: jest.fn(), invalidate: jest.fn() };
  const backfill = { run: jest.fn().mockResolvedValue({}) };
  const metrics = {
    sqsProcessingDuration: { startTimer: jest.fn(() => jest.fn()) },
    sqsMessagesProcessed: { inc: jest.fn() },
    searchIndexOperations: { inc: jest.fn() },
  };
  const handler = new IndexerEventHandler(
    indexer as any,
    fetcher as any,
    catalogNames as any,
    backfill as any,
    metrics as any,
  );
  return { handler, indexer, fetcher, metrics };
}

describe('IndexerEventHandler — index operation metrics', () => {
  it('counts a successful upsert', async () => {
    const { handler, metrics } = makeDeps();

    await handler.onUpsert('deal', 'd1');

    expect(metrics.searchIndexOperations.inc).toHaveBeenCalledWith({
      type: 'deal',
      operation: 'upsert',
      status: 'success',
    });
  });

  // A 404 from the owning service means the entity is gone; the handler turns
  // that into a removal, and the metric has to say so.
  it('counts a vanished entity as a delete, not an upsert', async () => {
    const { handler, fetcher, metrics } = makeDeps();
    fetcher.fetch.mockResolvedValue(null);

    await handler.onUpsert('contact', 'c1');

    expect(metrics.searchIndexOperations.inc).toHaveBeenCalledWith({
      type: 'contact',
      operation: 'delete',
      status: 'success',
    });
  });

  it('counts a failed upsert', async () => {
    const { handler, fetcher, metrics } = makeDeps();
    fetcher.fetch.mockRejectedValue(new Error('boom'));

    await expect(handler.onUpsert('deal', 'd1')).rejects.toThrow('boom');

    expect(metrics.searchIndexOperations.inc).toHaveBeenCalledWith({
      type: 'deal',
      operation: 'upsert',
      status: 'error',
    });
  });

  // Left to the backfill on purpose — not an error, so it must not pollute
  // the error rate the alert watches.
  it('counts an unsupported entity as skipped', async () => {
    const { handler, fetcher, metrics } = makeDeps();
    fetcher.fetch.mockRejectedValue(new UnsupportedEntityError('product'));

    await handler.onUpsert('product', 'p1');

    expect(metrics.searchIndexOperations.inc).toHaveBeenCalledWith({
      type: 'product',
      operation: 'upsert',
      status: 'skipped',
    });
  });

  it('counts an explicit delete', async () => {
    const { handler, metrics } = makeDeps();

    await handler.onDelete('deal', 'd1');

    expect(metrics.searchIndexOperations.inc).toHaveBeenCalledWith({
      type: 'deal',
      operation: 'delete',
      status: 'success',
    });
  });

  it('counts a failed delete and rethrows', async () => {
    const { handler, indexer, metrics } = makeDeps();
    indexer.remove.mockRejectedValue(new Error('os down'));

    await expect(handler.onDelete('deal', 'd1')).rejects.toThrow('os down');

    expect(metrics.searchIndexOperations.inc).toHaveBeenCalledWith({
      type: 'deal',
      operation: 'delete',
      status: 'error',
    });
  });
});
