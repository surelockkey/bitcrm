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
});
