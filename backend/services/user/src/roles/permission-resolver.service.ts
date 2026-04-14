import { Injectable } from '@nestjs/common';
import {
  type Role,
  type UserPermissionOverrides,
  type ResolvedPermissions,
  type PermissionMatrix,
  type DataScopeRules,
} from '@bitcrm/types';

@Injectable()
export class PermissionResolverService {
  resolve(role: Role, overrides?: UserPermissionOverrides): ResolvedPermissions {
    const hasOverrides = this.checkHasOverrides(overrides);

    const mergedPermissions = this.mergePermissions(
      role.permissions,
      overrides?.permissions,
    );

    const mergedDataScope = this.mergeDataScope(
      role.dataScope,
      overrides?.dataScope,
    );

    const mergedTransitions =
      overrides?.dealStageTransitions !== undefined
        ? overrides.dealStageTransitions
        : role.dealStageTransitions;

    return {
      roleId: role.id,
      roleName: role.name,
      isSystemRole: role.isSystem,
      permissions: mergedPermissions,
      dataScope: mergedDataScope,
      dealStageTransitions: mergedTransitions,
      hasOverrides,
    };
  }

  private mergePermissions(
    base: PermissionMatrix,
    overrides?: PermissionMatrix,
  ): PermissionMatrix {
    if (!overrides) return { ...base };

    const merged: PermissionMatrix = {};

    // Copy all base resources
    for (const resource of Object.keys(base)) {
      merged[resource] = { ...base[resource] };
    }

    // Merge override resources (override wins per action)
    for (const resource of Object.keys(overrides)) {
      if (merged[resource]) {
        merged[resource] = { ...merged[resource], ...overrides[resource] };
      } else {
        merged[resource] = { ...overrides[resource] };
      }
    }

    return merged;
  }

  private mergeDataScope(
    base: DataScopeRules,
    overrides?: DataScopeRules,
  ): DataScopeRules {
    if (!overrides) return { ...base };
    return { ...base, ...overrides };
  }

  private checkHasOverrides(overrides?: UserPermissionOverrides): boolean {
    if (!overrides) return false;

    const hasPermissions =
      overrides.permissions !== undefined &&
      Object.keys(overrides.permissions).length > 0;

    const hasDataScope =
      overrides.dataScope !== undefined &&
      Object.keys(overrides.dataScope).length > 0;

    const hasTransitions = overrides.dealStageTransitions !== undefined;

    return hasPermissions || hasDataScope || hasTransitions;
  }
}
