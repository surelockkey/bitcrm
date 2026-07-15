import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PermissionCacheReader } from '@bitcrm/shared';
import { JwtUser, ResolvedPermissions } from '@bitcrm/types';

/**
 * Resolves a caller's permissions the same way PermissionGuard does — Redis cache
 * first, then the user-service internal API — but exposed as a service because the
 * search endpoint gates on many resources at once rather than a single
 * @RequirePermission decorator.
 */
@Injectable()
export class PermissionsResolver {
  private readonly logger = new Logger(PermissionsResolver.name);
  private readonly userServiceUrl =
    process.env.USER_SERVICE_URL || 'http://localhost:4001';

  constructor(private readonly cacheReader: PermissionCacheReader) {}

  async resolve(user: JwtUser): Promise<ResolvedPermissions> {
    let resolved = user.roleId
      ? await this.cacheReader.getPermissions(user.id, user.roleId)
      : null;

    if (!resolved) {
      resolved = await this.resolveViaInternalApi(user.id);
    }

    if (!resolved) {
      this.logger.warn(`Unable to resolve permissions for user ${user.id}`);
      throw new ForbiddenException('Unable to resolve permissions');
    }
    return resolved;
  }

  private async resolveViaInternalApi(
    userId: string,
  ): Promise<ResolvedPermissions | null> {
    try {
      const res = await fetch(
        `${this.userServiceUrl}/api/users/internal/permissions/${userId}`,
      );
      if (!res.ok) return null;
      return (await res.json()) as ResolvedPermissions;
    } catch (err) {
      this.logger.warn(
        `Internal permission resolve failed for ${userId}: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
