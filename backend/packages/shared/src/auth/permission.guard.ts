import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from './permission.decorator';
import { PermissionCacheReader } from './permission-cache-reader';
import { type ResolvedPermissions } from '@bitcrm/types';

@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);
  private readonly userServiceUrl: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly cacheReader: PermissionCacheReader,
  ) {
    this.userServiceUrl =
      process.env.USER_SERVICE_URL || 'http://localhost:4001';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    const requiredPermission = this.reflector.getAllAndOverride<
      { resource: string; action: string } | undefined
    >(PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    if (requiredPermission) {
      return this.checkPermission(request, user, requiredPermission);
    }

    // No decorator → allow all authenticated users
    return true;
  }

  private async checkPermission(
    request: any,
    user: any,
    required: { resource: string; action: string },
  ): Promise<boolean> {
    // If JWT doesn't have roleId (old token), resolve via internal API
    if (!user.roleId) {
      const resolved = await this.resolveViaInternalApi(user.id);
      if (resolved) {
        request.resolvedPermissions = resolved;
        return this.evaluatePermission(resolved, required);
      }
      throw new ForbiddenException(
        'Unable to resolve permissions. User may not have a role assigned.',
      );
    }

    // Try Redis cache first
    let resolved = await this.cacheReader.getPermissions(
      user.id,
      user.roleId,
    );

    // On cache miss, fall back to internal API
    if (!resolved) {
      resolved = await this.resolveViaInternalApi(user.id);
    }

    if (!resolved) {
      this.logger.warn(`Permission denied: unable to resolve permissions for user ${user.id}`);
      throw new ForbiddenException('Unable to resolve permissions');
    }

    request.resolvedPermissions = resolved;
    return this.evaluatePermission(resolved, required);
  }

  private evaluatePermission(
    resolved: ResolvedPermissions,
    required: { resource: string; action: string },
  ): boolean {
    // Super Admin bypass
    if (resolved.isSystemRole && resolved.roleName === 'Super Admin') {
      return true;
    }

    const allowed =
      resolved.permissions[required.resource]?.[required.action] === true;

    if (!allowed) {
      this.logger.warn(
        `Permission denied: ${required.resource}.${required.action}`,
      );
      throw new ForbiddenException(
        `Missing permission: ${required.resource}.${required.action}`,
      );
    }

    return true;
  }

  private async resolveViaInternalApi(
    userId: string,
  ): Promise<ResolvedPermissions | null> {
    try {
      const url = `${this.userServiceUrl}/api/users/internal/permissions/${userId}`;
      const response = await fetch(url);
      if (!response.ok) return null;
      return (await response.json()) as ResolvedPermissions;
    } catch (error) {
      this.logger.warn(
        `Failed to resolve permissions via internal API for user ${userId}: ${error}`,
      );
      return null;
    }
  }
}
