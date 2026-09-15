import { IndexerEventHandler } from 'src/indexer/indexer.event-handler';

function makeDeps() {
  const indexer = {
    indexEntity: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    findDealIdsBy: jest.fn().mockResolvedValue([]),
    findConversationIdsByParty: jest.fn().mockResolvedValue([]),
    findConversationIdsByDeal: jest.fn().mockResolvedValue([]),
  };
  const fetcher = { fetch: jest.fn().mockResolvedValue({ id: 'x' }) };
  const catalogNames = { invalidateCustomFields: jest.fn(), invalidate: jest.fn() };
  const backfill = { run: jest.fn().mockResolvedValue({}) };
  const handler = new IndexerEventHandler(
    indexer as any,
    fetcher as any,
    catalogNames as any,
    backfill as any,
  );
  return { handler, indexer, fetcher, catalogNames, backfill };
}

describe('IndexerEventHandler', () => {
  it('reindexes the deals that reference an updated contact (client phone edits reach jobs)', async () => {
    const { handler, indexer, fetcher } = makeDeps();
    indexer.findDealIdsBy.mockResolvedValue(['d1', 'd2']);
    fetcher.fetch.mockImplementation(async (type: string, id: string) => ({ id, type }));

    await handler.onUpsert('contact', 'c1');

    expect(indexer.findDealIdsBy).toHaveBeenCalledWith('contactId', 'c1');
    // The contact itself + both of its deals get refetched and reindexed.
    expect(fetcher.fetch).toHaveBeenCalledWith('contact', 'c1');
    expect(fetcher.fetch).toHaveBeenCalledWith('deal', 'd1');
    expect(fetcher.fetch).toHaveBeenCalledWith('deal', 'd2');
  });

  it('reindexes the deals that reference an updated company', async () => {
    const { handler, indexer } = makeDeps();
    indexer.findDealIdsBy.mockResolvedValue(['d3']);

    await handler.onUpsert('company', 'co1');

    expect(indexer.findDealIdsBy).toHaveBeenCalledWith('companyId', 'co1');
  });

  it('does not cascade for non-client entity types', async () => {
    const { handler, indexer } = makeDeps();
    await handler.onUpsert('product', 'p1');
    expect(indexer.findDealIdsBy).not.toHaveBeenCalled();
    expect(indexer.findConversationIdsByParty).not.toHaveBeenCalled();
    expect(indexer.findConversationIdsByDeal).not.toHaveBeenCalled();
  });

  it('reindexes a conversation from a message event by refetching the thread', async () => {
    const { handler, indexer, fetcher } = makeDeps();
    fetcher.fetch.mockResolvedValue({ id: 'cv1', kind: 'client' });

    await handler.onUpsert('conversation', 'cv1');

    expect(fetcher.fetch).toHaveBeenCalledWith('conversation', 'cv1');
    expect(indexer.indexEntity).toHaveBeenCalledWith('conversation', { id: 'cv1', kind: 'client' });
    // A conversation is not a client: no deal cascade from it.
    expect(indexer.findDealIdsBy).not.toHaveBeenCalled();
    expect(indexer.findConversationIdsByParty).not.toHaveBeenCalled();
  });

  it('removes the conversation doc when the thread is gone (404)', async () => {
    const { handler, indexer, fetcher } = makeDeps();
    fetcher.fetch.mockResolvedValue(null);
    await handler.onUpsert('conversation', 'cv-gone');
    expect(indexer.remove).toHaveBeenCalledWith('conversation', 'cv-gone');
    expect(indexer.indexEntity).not.toHaveBeenCalled();
  });

  it('rebuilds the conversations of an edited contact, company or user (party name / numbers)', async () => {
    const { handler, indexer, fetcher } = makeDeps();
    indexer.findConversationIdsByParty.mockResolvedValue(['cv1', 'cv2']);
    fetcher.fetch.mockImplementation(async (type: string, id: string) =>
      id === 'cv2' ? null : { id, type },
    );

    await handler.onUpsert('contact', 'c1');

    expect(indexer.findConversationIdsByParty).toHaveBeenCalledWith('contact', 'c1');
    expect(fetcher.fetch).toHaveBeenCalledWith('conversation', 'cv1');
    expect(indexer.indexEntity).toHaveBeenCalledWith('conversation', { id: 'cv1', type: 'conversation' });
    // A thread that vanished between the lookup and the fetch leaves the index.
    expect(indexer.remove).toHaveBeenCalledWith('conversation', 'cv2');

    await handler.onUpsert('user', 'u1');
    expect(indexer.findConversationIdsByParty).toHaveBeenCalledWith('user', 'u1');
  });

  it('rebuilds the conversations that reference a changed job (roster drives assigned_only)', async () => {
    const { handler, indexer, fetcher } = makeDeps();
    indexer.findConversationIdsByDeal.mockResolvedValue(['cv1']);
    fetcher.fetch.mockImplementation(async (type: string, id: string) => ({ id, type }));

    await handler.onUpsert('deal', 'd1');

    expect(indexer.findConversationIdsByDeal).toHaveBeenCalledWith('d1');
    expect(indexer.indexEntity).toHaveBeenCalledWith('conversation', { id: 'cv1', type: 'conversation' });
  });

  it('a deal deletion never cascades', async () => {
    const { handler, indexer } = makeDeps();
    await handler.onDelete('deal', 'd1');
    expect(indexer.remove).toHaveBeenCalledWith('deal', 'd1');
    expect(indexer.findDealIdsBy).not.toHaveBeenCalled();
  });

  it('custom-field definition changes drop the cached defs and rebuild deal docs', async () => {
    const { handler, catalogNames, backfill } = makeDeps();
    await handler.onCustomFieldsChanged();
    expect(catalogNames.invalidateCustomFields).toHaveBeenCalled();
    expect(backfill.run).toHaveBeenCalledWith(['deal']);
  });
});
