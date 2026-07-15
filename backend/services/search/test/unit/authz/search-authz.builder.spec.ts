import { buildAuthorizationClause } from 'src/search/authz/search-authz.builder';
import { DataScope, ResolvedPermissions } from '@bitcrm/types';

const user = { id: 'u1', department: 'sales' };

function perms(overrides: Partial<ResolvedPermissions>): ResolvedPermissions {
  return {
    roleId: 'r1',
    roleName: 'Agent',
    isSystemRole: false,
    permissions: {},
    dataScope: {},
    dealStageTransitions: [],
    hasOverrides: false,
    ...overrides,
  };
}

/** Pull the per-resource `should` clauses out of the built authz clause. */
function shoulds(clause: any): any[] {
  return clause?.bool?.should ?? [];
}
function findResource(clause: any, resource: string): any {
  return shoulds(clause).find((c) =>
    (c.bool?.must ?? []).some(
      (m: any) => m.term?.permissionResource === resource,
    ),
  );
}

describe('buildAuthorizationClause', () => {
  it('gives Super Admin an unrestricted match_all', () => {
    const clause = buildAuthorizationClause(
      user,
      perms({ isSystemRole: true, roleName: 'Super Admin' }),
    );
    expect(clause).toEqual({ match_all: {} });
  });

  it('matches nothing when the user can view no resource', () => {
    const clause = buildAuthorizationClause(user, perms({ permissions: {} }));
    // impossible clause
    expect(clause).toEqual({ bool: { must_not: { match_all: {} } } });
  });

  it('includes only resources the user can view', () => {
    const clause = buildAuthorizationClause(
      user,
      perms({
        permissions: {
          deals: { view: true },
          products: { view: false },
          contacts: { view: true },
        },
        dataScope: { deals: DataScope.ALL, contacts: DataScope.ALL },
      }),
    );
    expect(findResource(clause, 'deals')).toBeDefined();
    expect(findResource(clause, 'contacts')).toBeDefined();
    expect(findResource(clause, 'products')).toBeUndefined();
    expect(clause.bool.minimum_should_match).toBe(1);
  });

  it('ALL scope adds no extra constraint beyond the resource term', () => {
    const clause = buildAuthorizationClause(
      user,
      perms({ permissions: { deals: { view: true } }, dataScope: { deals: DataScope.ALL } }),
    );
    const dealsClause = findResource(clause, 'deals');
    expect(dealsClause.bool.must).toEqual([{ term: { permissionResource: 'deals' } }]);
  });

  it('ASSIGNED_ONLY scope constrains ownerIds to the user id', () => {
    const clause = buildAuthorizationClause(
      user,
      perms({
        permissions: { deals: { view: true } },
        dataScope: { deals: DataScope.ASSIGNED_ONLY },
      }),
    );
    const dealsClause = findResource(clause, 'deals');
    expect(dealsClause.bool.must).toEqual(
      expect.arrayContaining([{ term: { ownerIds: 'u1' } }]),
    );
  });

  it('defaults to ASSIGNED_ONLY when a viewable resource has no dataScope entry', () => {
    const clause = buildAuthorizationClause(
      user,
      perms({ permissions: { deals: { view: true } }, dataScope: {} }),
    );
    const dealsClause = findResource(clause, 'deals');
    expect(dealsClause.bool.must).toEqual(
      expect.arrayContaining([{ term: { ownerIds: 'u1' } }]),
    );
  });

  it('DEPARTMENT scope constrains department for department-scoped resources (users)', () => {
    const clause = buildAuthorizationClause(
      user,
      perms({
        permissions: { users: { view: true } },
        dataScope: { users: DataScope.DEPARTMENT },
      }),
    );
    const usersClause = findResource(clause, 'users');
    expect(usersClause.bool.must).toEqual(
      expect.arrayContaining([{ term: { department: 'sales' } }]),
    );
  });

  it('DEPARTMENT scope behaves like ALL for resources with no department dimension (contacts)', () => {
    const clause = buildAuthorizationClause(
      user,
      perms({
        permissions: { contacts: { view: true } },
        dataScope: { contacts: DataScope.DEPARTMENT },
      }),
    );
    const contactsClause = findResource(clause, 'contacts');
    // no department term — only the resource term
    expect(contactsClause.bool.must).toEqual([{ term: { permissionResource: 'contacts' } }]);
  });

  it('builds independent scope constraints per resource', () => {
    const clause = buildAuthorizationClause(
      user,
      perms({
        permissions: { deals: { view: true }, users: { view: true } },
        dataScope: { deals: DataScope.ASSIGNED_ONLY, users: DataScope.DEPARTMENT },
      }),
    );
    expect(findResource(clause, 'deals').bool.must).toEqual(
      expect.arrayContaining([{ term: { ownerIds: 'u1' } }]),
    );
    expect(findResource(clause, 'users').bool.must).toEqual(
      expect.arrayContaining([{ term: { department: 'sales' } }]),
    );
  });
});
