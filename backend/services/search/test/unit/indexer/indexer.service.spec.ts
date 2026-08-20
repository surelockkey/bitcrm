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

function stubFetcher(entities: Record<string, any> = {}) {
  return {
    fetch: jest.fn(async (type: string, id: string) => entities[`${type}#${id}`] ?? null),
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
