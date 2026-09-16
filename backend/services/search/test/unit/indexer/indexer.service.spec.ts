import { SearchIndexerService } from 'src/indexer/indexer.service';

function makeClient() {
  return {
    index: jest.fn().mockResolvedValue({ body: {} }),
    bulk: jest.fn().mockResolvedValue({ body: { errors: false, items: [] } }),
    delete: jest.fn().mockResolvedValue({ body: {} }),
  };
}

function stubCatalogNames() {
  return {
    nameOf: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn(),
    customFieldDefs: jest.fn().mockResolvedValue([]),
  };
}

function stubFetcher(entities: Record<string, any> = {}, messages: Record<string, any[]> = {}) {
  return {
    fetch: jest.fn(async (type: string, id: string) => entities[`${type}#${id}`] ?? null),
    fetchConversationMessages: jest.fn(async (id: string) => messages[id] ?? []),
  };
}

function makeService(client: any, fetcher: any = stubFetcher()) {
  return new SearchIndexerService(
    { client } as any,
    stubCatalogNames() as any,
    fetcher as any,
  );
}

describe('SearchIndexerService', () => {
  it('maps and upserts an entity keyed by type#id', async () => {
    const client = makeClient();
    await makeService(client).indexEntity('company', {
      id: 'co1',
      title: 'Acme',
      phones: [],
      emails: [],
      status: 'active',
      createdBy: 'u1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    });
    expect(client.index).toHaveBeenCalledTimes(1);
    expect(client.index.mock.calls[0][0].id).toBe('company#co1');
    expect(client.index.mock.calls[0][0].body.title).toBe('Acme');
  });

  const deal = {
    id: 'd1',
    dealNumber: 'K4T9ZW',
    contactId: 'c1',
    companyId: 'co1',
    serviceArea: 'Brooklyn',
    address: {},
    jobTypeId: 'jt1',
    superStatus: 'in_progress',
    assignedTechIds: [],
    assignedDispatcherId: 'disp1',
    priority: 'normal',
    tagIds: [],
    status: 'active',
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  };

  it('enriches a deal with its contact and company so client data is searchable', async () => {
    const client = makeClient();
    const fetcher = stubFetcher({
      'contact#c1': { firstName: 'John', lastName: 'Smith', phones: ['(728) 347-8370'], emails: ['j@x.com'] },
      'company#co1': { title: 'Acme Corp' },
    });
    await makeService(client, fetcher).indexEntity('deal', deal);
    const doc = client.index.mock.calls[0][0].body;
    expect(doc.keywords).toEqual(
      expect.arrayContaining(['John Smith', '7283478370', 'Acme Corp']),
    );
    expect(doc.contactId).toBe('c1');
  });

  it('still indexes the deal when the contact fetch fails', async () => {
    const client = makeClient();
    const fetcher = { fetch: jest.fn().mockRejectedValue(new Error('crm down')) };
    await makeService(client, fetcher).indexEntity('deal', deal);
    expect(client.index).toHaveBeenCalledTimes(1);
    expect(client.index.mock.calls[0][0].id).toBe('deal#d1');
  });

  it('finds deal ids referencing a contact for reindex-on-client-change', async () => {
    const client: any = makeClient();
    client.search = jest.fn().mockResolvedValue({
      body: { hits: { hits: [{ _source: { entityId: 'd1' } }, { _source: { entityId: 'd2' } }] } },
    });
    const ids = await makeService(client).findDealIdsBy('contactId', 'c1');
    expect(ids).toEqual(['d1', 'd2']);
    const query = client.search.mock.calls[0][0].body.query;
    expect(JSON.stringify(query)).toContain('"contactId":"c1"');
  });

  const conversation = {
    id: 'cv1',
    kind: 'client',
    partyKind: 'contact',
    partyId: 'c1',
    addresses: { phones: ['+17283478370'], emails: [] },
    state: 'open',
    unread: false,
    unreadCount: 0,
    flagged: false,
    lastDealId: 'd1',
    lastMessagePreview: 'thanks!',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-15T10:05:00.000Z',
  };

  describe('conversation enrichment', () => {
    it('reads the feed, the party and the referenced jobs, and indexes the assembled document', async () => {
      const client = makeClient();
      const fetcher = stubFetcher(
        {
          'contact#c1': { firstName: 'John', lastName: 'Smith', phones: ['(212) 555-0100'], emails: ['j@x.com'] },
          'deal#d1': { id: 'd1', dealNumber: 'K4T9ZW', assignedTechIds: ['tech1'] },
          'deal#d2': { id: 'd2', dealNumber: 'B7Q2LM', assignedTechIds: ['tech2'] },
        },
        {
          cv1: [
            { id: 'm2', body: 'thanks!', dealId: 'd2', createdAt: '2026-09-15T10:05:00.000Z' },
            { id: 'm1', body: 'Gate code 4210', dealId: 'd1', createdAt: '2026-09-15T10:00:00.000Z' },
          ],
        },
      );
      await makeService(client, fetcher).indexEntity('conversation', conversation);

      expect(fetcher.fetchConversationMessages).toHaveBeenCalledWith('cv1', expect.any(Number));
      expect(fetcher.fetch).toHaveBeenCalledWith('contact', 'c1');
      expect(fetcher.fetch).toHaveBeenCalledWith('deal', 'd1');
      expect(fetcher.fetch).toHaveBeenCalledWith('deal', 'd2');
      // d1 is referenced twice (lastDealId + a message) but fetched once.
      expect(fetcher.fetch.mock.calls.filter(([t, id]) => t === 'deal' && id === 'd1')).toHaveLength(1);

      expect(client.index.mock.calls[0][0].id).toBe('conversation#cv1');
      const doc = client.index.mock.calls[0][0].body;
      expect(doc.title).toBe('John Smith');
      expect(doc.ownerIds).toEqual(expect.arrayContaining(['tech1', 'tech2']));
      expect(doc.dealIds).toEqual(['d1', 'd2']);
      expect(doc.keywords).toEqual(expect.arrayContaining(['K4T9ZW', 'B7Q2LM', '2125550100', 'j@x.com']));
      expect(doc.body).toBe('thanks!\nGate code 4210');
    });

    it('resolves a company party by title and a user party by name', async () => {
      const fetcher = stubFetcher({
        'company#co1': { title: 'Acme Corp', phones: ['212-555-0199'], emails: [] },
        'user#u1': { firstName: 'Bob', lastName: 'Lee', email: 'bob@corp.com' },
      });
      const svc = makeService(makeClient(), fetcher);

      const company = await svc.resolveConversationContext({ ...conversation, partyKind: 'company', partyId: 'co1' });
      expect(company.partyName).toBe('Acme Corp');
      expect(company.partyPhones).toEqual(['212-555-0199']);

      const user = await svc.resolveConversationContext({ ...conversation, partyKind: 'user', partyId: 'u1' });
      expect(user.partyName).toBe('Bob Lee');
      expect(user.messages).toEqual([]);
    });

    it('still indexes the thread when the feed, the party or a job cannot be fetched', async () => {
      const client = makeClient();
      const fetcher = {
        fetch: jest.fn().mockRejectedValue(new Error('crm down')),
        fetchConversationMessages: jest.fn().mockRejectedValue(new Error('messaging down')),
      };
      await makeService(client, fetcher).indexEntity('conversation', conversation);
      expect(client.index).toHaveBeenCalledTimes(1);
      const doc = client.index.mock.calls[0][0].body;
      // Titled by its number, findable by its number; no owners, no body.
      expect(doc.title).toBe('+17283478370');
      expect(doc.keywords).toContain('7283478370');
      expect(doc.ownerIds).toEqual([]);
      expect(doc.body).toBeUndefined();
      expect(doc.dealIds).toEqual(['d1']);
    });

    it('reuses the backfill cache for party and job fetches', async () => {
      const fetcher = stubFetcher({
        'contact#c1': { firstName: 'John', lastName: 'Smith' },
        'deal#d1': { id: 'd1', dealNumber: 'K4T9ZW', assignedTechIds: [] },
      });
      const svc = makeService(makeClient(), fetcher);
      const cache = new Map<string, any>();
      await svc.resolveConversationContext(conversation, cache);
      await svc.resolveConversationContext({ ...conversation, id: 'cv2' }, cache);
      expect(fetcher.fetch).toHaveBeenCalledTimes(2); // contact + deal, once each
      expect(cache.get('contact#c1')).toMatchObject({ firstName: 'John' });
    });

    it('finds conversation ids by party and by referenced job for the reindex fan-out', async () => {
      const client: any = makeClient();
      client.search = jest.fn().mockResolvedValue({
        body: { hits: { hits: [{ _source: { entityId: 'cv1' } }] } },
      });
      const svc = makeService(client);

      expect(await svc.findConversationIdsByParty('contact', 'c1')).toEqual(['cv1']);
      let filter = client.search.mock.calls[0][0].body.query.bool.filter;
      expect(filter).toEqual(
        expect.arrayContaining([
          { term: { type: 'conversation' } },
          { term: { partyId: 'c1' } },
          { term: { partyKind: 'contact' } },
        ]),
      );

      expect(await svc.findConversationIdsByDeal('d1')).toEqual(['cv1']);
      filter = client.search.mock.calls[1][0].body.query.bool.filter;
      expect(filter).toEqual(
        expect.arrayContaining([{ term: { type: 'conversation' } }, { term: { dealIds: 'd1' } }]),
      );
    });
  });

  it('skips entities with no mapper', async () => {
    const client = makeClient();
    await makeService(client).indexEntity('stock' as any, {});
    expect(client.index).not.toHaveBeenCalled();
  });

  it('bulk indexes with interleaved action/document lines', async () => {
    const client = makeClient();
    const n = await makeService(client).bulkIndex([
      { docId: 'deal#1', entityId: '1' } as any,
      { docId: 'deal#2', entityId: '2' } as any,
    ]);
    expect(n).toBe(2);
    const body = client.bulk.mock.calls[0][0].body;
    expect(body).toHaveLength(4); // 2 action lines + 2 docs
    expect(body[0].index._id).toBe('deal#1');
  });

  it('deletes by type#id', async () => {
    const client = makeClient();
    await makeService(client).remove('deal', 'd9');
    expect(client.delete.mock.calls[0][0].id).toBe('deal#d9');
  });

  it('treats a 404 on delete as success (idempotent)', async () => {
    const client = makeClient();
    client.delete.mockRejectedValueOnce({ meta: { statusCode: 404 } });
    await expect(makeService(client).remove('deal', 'gone')).resolves.toBeUndefined();
  });

  it('rethrows non-404 delete errors', async () => {
    const client = makeClient();
    client.delete.mockRejectedValueOnce({ meta: { statusCode: 500 } });
    await expect(makeService(client).remove('deal', 'x')).rejects.toBeDefined();
  });
});
