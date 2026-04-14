import { DataScope, type ResolvedPermissions } from '@bitcrm/types';

interface DataScopeFilter {
  scope: DataScope;
  department?: string;
  userId?: string;
}

/**
 * Determines the data scope filter for a given resource based on user's resolved permissions.
 * Super Admin always gets full access (scope: ALL).
 * Unknown resources default to ASSIGNED_ONLY (most restrictive).
 */
export function getDataScopeFilter(
  user: { id: string; department: string },
  resource: string,
  resolvedPermissions: ResolvedPermissions,
): DataScopeFilter {
  // Super Admin bypass
  if (resolvedPermissions.isSystemRole && resolvedPermissions.roleName === 'Super Admin') {
    return { scope: DataScope.ALL };
  }

  const scope = resolvedPermissions.dataScope[resource];

  // Default to most restrictive if resource not configured
  if (!scope) {
    return { scope: DataScope.ASSIGNED_ONLY, userId: user.id };
  }

  switch (scope) {
    case DataScope.ALL:
      return { scope: DataScope.ALL };
    case DataScope.DEPARTMENT:
      return { scope: DataScope.DEPARTMENT, department: user.department };
    case DataScope.ASSIGNED_ONLY:
      return { scope: DataScope.ASSIGNED_ONLY, userId: user.id };
    default:
      return { scope: DataScope.ASSIGNED_ONLY, userId: user.id };
  }
}
