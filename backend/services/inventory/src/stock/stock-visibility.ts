import {
  DataScope,
  type JwtUser,
  type LocationSummary,
  type ResolvedPermissions,
} from '@bitcrm/types';
import { type ContainerAssignment } from '../user-containers/container-assignment.resolver';

/** Who is asking: the request user and the permissions the guard resolved for them. */
export interface StockViewer {
  user: JwtUser;
  permissions?: ResolvedPermissions;
}

/**
 * The locations the caller's own list routes would show them, so the popup
 * and `GET /warehouses` / `GET /containers` agree: a warehouse needs
 * `warehouses.view`, a container `containers.view` plus the containers data
 * scope (`assigned_only` — the van they are assigned to, or every van for a
 * user with "All locations"; `department` — their department's). No resolved
 * permissions means the guard
 * did not run (unit tests) and the Super Admin bypasses the matrix the way
 * the guard lets them.
 */
export async function visibleLocations(
  viewer: StockViewer | undefined,
  assignmentOf: (userId: string) => Promise<ContainerAssignment>,
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
      const assignment = await assignmentOf(viewer.user.id);
      if (assignment.allLocations) return { warehouses, containers: () => true };
      const own = assignment.containerId;
      return { warehouses, containers: (l) => own !== undefined && l.id === own };
    }
    case DataScope.DEPARTMENT:
      return { warehouses, containers: (l) => l.department === viewer.user.department };
    default:
      return { warehouses, containers: () => true };
  }
}
