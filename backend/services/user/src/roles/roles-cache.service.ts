import { Injectable } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { type ResolvedPermissions } from '@bitcrm/types';

/**
 * How long a resolved permission set lives in Redis. Every path that changes
 * effective permissions (role edit, boot-time reconcile, role assignment,
 * per-user overrides set/clear) deletes the affected keys explicitly, so the
 * TTL is only a backstop — long enough that the guards in every service rarely
 * miss and fall through to the internal API. Deactivation does not ride on it
 * either: `user:disabled:<id>` is written without a TTL and checked first.
 */
const DEFAULT_PERMISSION_TTL_SECONDS = 600;

/** Keys per DEL — one round trip per chunk instead of one per user. */
const INVALIDATE_CHUNK = 500;

function permissionTtlSeconds(): number {
  const parsed = Number(process.env.PERMISSION_CACHE_TTL_SECONDS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PERMISSION_TTL_SECONDS;
}

@Injectable()
export class RolesCacheService {
  private readonly ttlSeconds = permissionTtlSeconds();

  constructor(private readonly redis: RedisService) {}

  async getRolePermissions(roleId: string): Promise<any | null> {
    const data = await this.redis.client.get(`role:permissions:${roleId}`);
    if (!data) return null;
    return JSON.parse(data);
  }

  async setRolePermissions(roleId: string, data: any): Promise<void> {
    await this.redis.client.set(
      `role:permissions:${roleId}`,
      JSON.stringify(data),
      'EX',
      this.ttlSeconds,
    );
  }

  async invalidateRole(roleId: string): Promise<void> {
    await this.redis.client.del(`role:permissions:${roleId}`);
  }

  async getUserPermissions(userId: string): Promise<ResolvedPermissions | null> {
    const data = await this.redis.client.get(`user:permissions:${userId}`);
    if (!data) return null;
    return JSON.parse(data);
  }

  async setUserPermissions(userId: string, data: ResolvedPermissions): Promise<void> {
    await this.redis.client.set(
      `user:permissions:${userId}`,
      JSON.stringify(data),
      'EX',
      this.ttlSeconds,
    );
  }

  async invalidateUserPermissions(userId: string): Promise<void> {
    await this.redis.client.del(`user:permissions:${userId}`);
  }

  async invalidateAllUsersWithRole(roleId: string, userIds: string[]): Promise<void> {
    for (let i = 0; i < userIds.length; i += INVALIDATE_CHUNK) {
      const keys = userIds
        .slice(i, i + INVALIDATE_CHUNK)
        .map((userId) => `user:permissions:${userId}`);
      await this.redis.client.del(...keys);
    }
  }
}
