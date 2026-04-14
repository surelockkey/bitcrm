import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { type ResolvedPermissions } from '@bitcrm/types';

const USER_PERMISSIONS_PREFIX = 'user:permissions:';
const ROLE_PERMISSIONS_PREFIX = 'role:permissions:';
const USER_DISABLED_PREFIX = 'user:disabled:';

@Injectable()
export class PermissionCacheReader {
  constructor(private readonly redis: RedisService) {}

  /** Returns true if the user has been deactivated */
  async isUserDisabled(userId: string): Promise<boolean> {
    const val = await this.redis.client.get(`${USER_DISABLED_PREFIX}${userId}`);
    return val === '1';
  }

  /** Mark user as disabled (called on deactivate) */
  async setUserDisabled(userId: string): Promise<void> {
    await this.redis.client.set(`${USER_DISABLED_PREFIX}${userId}`, '1');
  }

  /** Remove disabled flag (called on reactivate) */
  async removeUserDisabled(userId: string): Promise<void> {
    await this.redis.client.del(`${USER_DISABLED_PREFIX}${userId}`);
  }

  /**
   * Get resolved permissions for a user.
   * Checks user-level cache first, then role-level.
   * Returns null on cache miss (caller should fall back to internal API).
   */
  async getPermissions(
    userId: string,
    roleId: string,
  ): Promise<ResolvedPermissions | null> {
    const userData = await this.redis.client.get(
      `${USER_PERMISSIONS_PREFIX}${userId}`,
    );
    if (userData) {
      return JSON.parse(userData);
    }

    const roleData = await this.redis.client.get(
      `${ROLE_PERMISSIONS_PREFIX}${roleId}`,
    );
    if (roleData) {
      return JSON.parse(roleData);
    }

    return null;
  }
}
