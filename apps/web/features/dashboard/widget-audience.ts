import type { PermissionMatrix, Role } from "@bitcrm/types";

/** The widget a permissions dialog is editing. */
export interface WidgetGrant {
  /** The action under the `dashboard` resource, e.g. `view_jobs_by_status`. */
  action: string;
  /** What the dialog calls it. */
  label: string;
}

export interface AudienceRow {
  roleId: string;
  name: string;
  description?: string;
  sees: boolean;
  /**
   * Super Admin bypasses the matrix in `PermissionGuard`, so its row is shown
   * ticked and locked — unticking it would write a `false` the server ignores,
   * which is worse than not offering the choice.
   */
  locked: boolean;
}

const SUPER_ADMIN = "Super Admin";

/** Whether a role currently holds the widget's grant. */
export function roleSees(role: Role, action: string): boolean {
  if (role.name === SUPER_ADMIN) return true;
  const dashboard = role.permissions?.dashboard as Record<string, boolean> | undefined;
  return dashboard?.[action] === true;
}

/** The dialog's rows, most powerful role first, as the roles screen orders them. */
export function audienceRows(roles: Role[], action: string): AudienceRow[] {
  return [...roles]
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))
    .map((role) => ({
      roleId: role.id,
      name: role.name,
      description: role.description,
      sees: roleSees(role, action),
      locked: role.name === SUPER_ADMIN,
    }));
}

/**
 * The `permissions` patch that flips one widget grant on one role.
 *
 * The whole matrix goes back, not just the changed key: `PUT /roles/:id`
 * replaces what it is given, and sending the `dashboard` block alone would
 * drop every other resource the role holds.
 */
export function grantPatch(role: Role, action: string, sees: boolean): PermissionMatrix {
  const dashboard = (role.permissions?.dashboard ?? {}) as Record<string, boolean>;
  return {
    ...role.permissions,
    dashboard: { ...dashboard, [action]: sees },
  };
}

/**
 * Which roles actually changed. A dialog that PUTs every role on save would
 * bump six roles — and re-resolve six permission caches — to move one tick.
 */
export function changedRoles(
  roles: Role[],
  action: string,
  next: Record<string, boolean>,
): Role[] {
  return roles.filter((role) => {
    if (role.name === SUPER_ADMIN) return false;
    const wanted = next[role.id];
    return wanted !== undefined && wanted !== roleSees(role, action);
  });
}
