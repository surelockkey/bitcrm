import {
  DataScope,
  type JwtUser,
  type LocationSummary,
  type ResolvedPermissions,
} from '@bitcrm/types';

/** Who is asking: the request user and the permissions the guard resolved for them. */
export interface StockViewer {
  user: JwtUser;
  permissions?: ResolvedPermissions;
}

/**
 * The locations the caller's own list routes would show them, so the popup
 * and `GET /warehouses` / `GET /containers` agree: a warehouse needs
 * `warehouses.view`, a container `containers.view` plus the containers data
 * scope (`assigned_only` — the van they are assigned to, `ownContainerId`;
 * `department` — their department's). No resolved permissions means the guard
 * did not run (unit tests) and the Super Admin bypasses the matrix the way
 * the guard lets them.
 */
export async function visibleLocations(
  viewer: StockViewer | undefined,
  ownContainerId: (userId: string) => Promise<string | undefined>,
): Promise<{
  warehouses: boolean;
  containers: (location: LocationSummary) => boolean;
}> {
  const resolved = viewer?.permissions;
  if (!viewer || !resolved || (resolved.isSystemRole && resolved.roleName === 'Super Admin')) {
    return { warehouses: true, containers: () => true };
  }

  const warehouses = resolved.permissions.warehouses?.view === true;
  if (resolved.permissions.containers?.view !== true) {
    return { warehouses, containers: () => false };
  }
  switch (resolved.dataScope.containers) {
    case DataScope.ASSIGNED_ONLY: {
      const own = await ownContainerId(viewer.user.id);
      return { warehouses, containers: (l) => own !== undefined && l.id === own };
    }
    case DataScope.DEPARTMENT:
      return { warehouses, containers: (l) => l.department === viewer.user.department };
    default:
      return { warehouses, containers: () => true };
  }
}
