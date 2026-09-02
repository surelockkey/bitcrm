import { type ResolvedPermissions } from '@bitcrm/types';
import { hasPermission } from '../../../src/auth/has-permission.util';

function resolved(
  overrides: Partial<ResolvedPermissions> = {},
): ResolvedPermissions {
  return {
    roleId: 'role-technician',
    roleName: 'Technician',
    isSystemRole: true,
    permissions: {},
    dataScope: {},
    dealStageTransitions: [],
    hasOverrides: false,
    ...overrides,
  };
}

describe('hasPermission', () => {
  it('is true when the action is granted', () => {
    const perms = resolved({
      permissions: { contacts: { view: true, view_numbers: true } },
    });
    expect(hasPermission(perms, 'contacts', 'view_numbers')).toBe(true);
  });

  it('is false when the action is explicitly denied', () => {
    const perms = resolved({
      permissions: { contacts: { view: true, view_numbers: false } },
    });
    expect(hasPermission(perms, 'contacts', 'view_numbers')).toBe(false);
  });

  it('is false when the action is absent — deny by default', () => {
    // A custom role created before the action existed has no key at all. That
    // must read as denied (privacy-safe), never as granted.
    const perms = resolved({ permissions: { contacts: { view: true } } });
    expect(hasPermission(perms, 'contacts', 'view_numbers')).toBe(false);
  });

  it('is false when the resource is absent entirely', () => {
    expect(hasPermission(resolved(), 'contacts', 'view_numbers')).toBe(false);
  });

  /**
   * The guard bypasses Super Admin before it ever evaluates the matrix, so any
   * hand-rolled check that forgets this shows a Super Admin redacted data —
   * which reads as a bug in the masking feature rather than in the check.
   */
  it('is true for a Super Admin even with nothing in the matrix', () => {
    const perms = resolved({
      roleId: 'role-super-admin',
      roleName: 'Super Admin',
      isSystemRole: true,
      permissions: {},
    });
    expect(hasPermission(perms, 'contacts', 'view_numbers')).toBe(true);
  });

  it('does not bypass for a non-system role that is merely named Super Admin', () => {
    const perms = resolved({
      roleName: 'Super Admin',
      isSystemRole: false,
      permissions: {},
    });
    expect(hasPermission(perms, 'contacts', 'view_numbers')).toBe(false);
  });

  /**
   * Ungated handlers never populate `request.resolvedPermissions`, so callers
   * that read it directly hand us undefined. Failing closed there is the whole
   * point — an unresolvable viewer must not see numbers.
   */
  it('is false when permissions could not be resolved at all', () => {
    expect(hasPermission(undefined, 'contacts', 'view_numbers')).toBe(false);
    expect(hasPermission(null, 'contacts', 'view_numbers')).toBe(false);
  });
});
