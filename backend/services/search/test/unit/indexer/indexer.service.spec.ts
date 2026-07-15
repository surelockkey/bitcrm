import { SearchIndexerService } from 'src/indexer/indexer.service';

function makeClient() {
  return {
    index: jest.fn().mockResolvedValue({ body: {} }),
    bulk: jest.fn().mockResolvedValue({ body: { errors: false, items: [] } }),
    delete: jest.fn().mockResolvedValue({ body: {} }),
  };
}

function makeService(client: any) {
  return new SearchIndexerService({ client } as any);
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
