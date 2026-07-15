import {
  DataScope,
  RESOURCE_REGISTRY,
  Resource,
  ResolvedPermissions,
} from '@bitcrm/types';

export interface AuthzUser {
  id: string;
  department: string;
}

/** OpenSearch query DSL fragment (kept loose — the shapes are small and stable). */
export type QueryClause = Record<string, any>;

/**
 * Resources whose search documents actually carry a `department` field. Only for
 * these does DEPARTMENT scope translate to a department filter; for everything
 * else there is no department to restrict by, so DEPARTMENT behaves like ALL
 * (restricting further would hide every document of that type). Revisit if/when
 * more entities gain a department dimension.
 */
const DEPARTMENT_DIMENSION_RESOURCES: ReadonlySet<Resource> = new Set([
  'users',
  'technicians',
  'containers',
]);

/** An impossible clause — matches zero documents. */
const MATCH_NONE: QueryClause = { bool: { must_not: { match_all: {} } } };

/**
 * Translate a caller's resolved permissions into a single OpenSearch clause that,
 * when placed in a bool `filter`, restricts results to exactly the documents the
 * caller is allowed to read — same rules the owning services enforce:
 *   - only resources the caller can `view`
 *   - per-resource data scope: ALL (no constraint) / DEPARTMENT (own dept) /
 *     ASSIGNED_ONLY (own id in ownerIds), defaulting to the most restrictive
 *   - Super Admin bypasses all constraints
 *
 * This is enforced at query time (not baked into the index) because permissions
 * change independently of the indexed entities.
 */
export function buildAuthorizationClause(
  user: AuthzUser,
  permissions: ResolvedPermissions,
): QueryClause {
  // Super Admin sees everything (mirrors getDataScopeFilter / PermissionGuard).
  if (permissions.isSystemRole && permissions.roleName === 'Super Admin') {
    return { match_all: {} };
  }

  const should: QueryClause[] = [];

  for (const resource of Object.keys(RESOURCE_REGISTRY) as Resource[]) {
    const canView = permissions.permissions?.[resource]?.view === true;
    if (!canView) continue;

    const must: QueryClause[] = [{ term: { permissionResource: resource } }];
    // Default to the most restrictive scope when unconfigured (matches getDataScopeFilter).
    const scope = permissions.dataScope?.[resource] ?? DataScope.ASSIGNED_ONLY;

    switch (scope) {
      case DataScope.ALL:
        break;
      case DataScope.DEPARTMENT:
        if (DEPARTMENT_DIMENSION_RESOURCES.has(resource)) {
          must.push({ term: { department: user.department } });
        }
        break;
      case DataScope.ASSIGNED_ONLY:
      default:
        must.push({ term: { ownerIds: user.id } });
        break;
    }

    should.push({ bool: { must } });
  }

  if (should.length === 0) return MATCH_NONE;

  return { bool: { should, minimum_should_match: 1 } };
}
