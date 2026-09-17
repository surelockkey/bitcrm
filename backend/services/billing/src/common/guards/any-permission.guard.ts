import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionCacheReader, fetchResolvedPermissions, hasPermission } from '@bitcrm/shared';
import type { ResolvedPermissions } from '@bitcrm/types';
import { USER_SERVICE_URL } from '../constants/services.constants';

const ANY_PERMISSION_KEY = 'billing:anyPermission';

type Requirement = [resource: string, action: string];

/**
 * `@RequireAnyPermission(['invoices','send'], ['estimates','send'])` — the
 * shared PermissionGuard only understands one resource.action, so routes that
 * accept either use this guard instead (and carry no @RequirePermission).
 * Resolution mirrors PermissionGuard: Redis cache, then user-service.
 */
export function RequireAnyPermission(...requirements: Requirement[]) {
  return applyDecorators(SetMetadata(ANY_PERMISSION_KEY, requirements), UseGuards(AnyPermissionGuard));
}

@Injectable()
export class AnyPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cache: PermissionCacheReader,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<Requirement[] | undefined>(ANY_PERMISSION_KEY, context.getHandler());
    if (!required?.length) return true;
    const request = context.switchToHttp().getRequest();
    const user = request.user as { id: string; roleId?: string } | undefined;
    if (!user) throw new ForbiddenException('Unable to resolve permissions');

    let resolved: ResolvedPermissions | null = request.resolvedPermissions ?? null;
    if (!resolved && user.roleId) resolved = await this.cache.getPermissions(user.id, user.roleId);
    if (!resolved) resolved = await fetchResolvedPermissions(USER_SERVICE_URL, user.id);
    if (!resolved) throw new ForbiddenException('Unable to resolve permissions');
    request.resolvedPermissions = resolved;

    if (required.some(([r, a]) => hasPermission(resolved, r, a))) return true;
    throw new ForbiddenException(
      `Missing permission: one of ${required.map(([r, a]) => `${r}.${a}`).join(', ')}`,
    );
  }
}
