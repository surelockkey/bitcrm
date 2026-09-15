import { SearchService } from 'src/search/search.service';
import { DataScope, ResolvedPermissions } from '@bitcrm/types';

const user = { id: 'u1', department: 'sales', email: 'u@x.com', cognitoSub: 's', roleId: 'r1' };

function agentPerms(): ResolvedPermissions {
  return {
    roleId: 'r1',
    roleName: 'Agent',
    isSystemRole: false,
    permissions: { deals: { view: true } },
    dataScope: { deals: DataScope.ASSIGNED_ONLY },
    dealStageTransitions: [],
    hasOverrides: false,
  };
}

describe('SearchService', () => {
  it('short-circuits an empty query without touching OpenSearch or permissions', async () => {
    const client = { search: jest.fn() };
    const permissions = { resolve: jest.fn() };
    const svc = new SearchService({ client } as any, permissions as any);

    const res = await svc.search(user as any, {
      q: '',
      mode: 'typeahead',
      perTypeLimit: 5,
      page: 1,
      size: 20,
    });

    expect(res.groups).toEqual([]);
    expect(client.search).not.toHaveBeenCalled();
    expect(permissions.resolve).not.toHaveBeenCalled();
  });

  it('injects the caller authorization clause into the executed query', async () => {
    const client = {
      search: jest.fn().mockResolvedValue({
        body: { took: 3, hits: { total: { value: 0 }, hits: [] }, aggregations: { types: { buckets: [] } } },
      }),
    };
    const permissions = { resolve: jest.fn().mockResolvedValue(agentPerms()) };
    const svc = new SearchService({ client } as any, permissions as any);

    await svc.search(user as any, {
      q: 'acme',
      mode: 'full',
      perTypeLimit: 5,
      page: 1,
      size: 20,
    });

    expect(permissions.resolve).toHaveBeenCalledWith(user);
    const body = client.search.mock.calls[0][0].body;
    const filter = body.query.function_score.query.bool.filter;
    // ASSIGNED_ONLY deals clause must be present → ownerIds bound to the user.
    const authz = filter[0];
    const dealsShould = authz.bool.should[0];
    expect(dealsShould.bool.must).toEqual(
      expect.arrayContaining([{ term: { ownerIds: 'u1' } }]),
    );
  });

  it('gates conversations on messages.view and withholds number-only titles without contacts.view_numbers', async () => {
    const client = {
      search: jest.fn().mockResolvedValue({
        body: {
          took: 2,
          hits: { total: { value: 0 }, hits: [] },
          aggregations: {
            types: {
              buckets: [
                {
                  key: 'conversation',
                  doc_count: 2,
                  top: {
                    hits: {
                      hits: [
                        { _score: 2, _source: { entityId: 'cv1', type: 'conversation', title: '+14045551234', url: '/messages/cv1' } },
                        { _score: 1, _source: { entityId: 'cv2', type: 'conversation', title: 'John Smith', url: '/messages/cv2' } },
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
      }),
    };
    const perms: ResolvedPermissions = {
      ...agentPerms(),
      permissions: { messages: { view: true }, contacts: { view: true, view_numbers: false } },
      dataScope: { messages: DataScope.ASSIGNED_ONLY, contacts: DataScope.ALL },
    };
    const permissions = { resolve: jest.fn().mockResolvedValue(perms) };
    const svc = new SearchService({ client } as any, permissions as any);

    const res = await svc.search(user as any, { q: '404', mode: 'typeahead', perTypeLimit: 5, page: 1, size: 20 });

    // Authorization: the messages resource is in the clause, scoped to the caller's threads.
    const authz = client.search.mock.calls[0][0].body.query.function_score.query.bool.filter[0];
    const messagesShould = authz.bool.should.find((c: any) =>
      c.bool.must.some((m: any) => m.term?.permissionResource === 'messages'),
    );
    expect(messagesShould.bool.must).toEqual(expect.arrayContaining([{ term: { ownerIds: 'u1' } }]));

    // Masking: the number-only thread is renamed, the named one and the link survive.
    const group = res.groups.find((g) => g.type === 'conversation')!;
    expect(group.items.map((h) => h.title)).toEqual(['Unknown number', 'John Smith']);
    expect(group.items[0].url).toBe('/messages/cv1');
  });
});
