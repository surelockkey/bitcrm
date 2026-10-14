import { Injectable } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { type ResolvedPermissions, type Role } from '@bitcrm/types';

/**
 * How long a resolved permission set lives in Redis. Every path that changes
 * effective permissions (role edit, boot-time reconcile, role assignment,
 * per-user overrides set/clear) deletes the affected keys explicitly, so the
 * TTL is only a backstop — long enough that the guards in every service rarely
 * miss and fall through to the internal API. Deactivation does not ride on it
 * either: `user:disabled:<id>` is written without a TTL and checked first.
 */
const DEFAULT_PERMISSION_TTL_SECONDS = 600;

/**
 * The role row itself (`role:entity:<id>`), shared by every user-service task.
 * Read on every technician route (`isPrivileged`) and every role check, and it
 * changes only through `RolesService` (create / update / delete / the boot
 * reconcile), each of which invalidates it — the TTL is a backstop for a
 * write made outside the service (a script).
 *
 * Invalidation is a generation bump (`INCR role:entity:<id>:gen` + `DEL`),
 * as in messaging's `RedisCachedValue`: the cached value carries the
 * generation its load started under, and a value whose generation is not the
 * current one is a miss. A load that read DynamoDB before an update and
 * writes after its invalidation therefore tags its stale role with the old
 * generation, and no reader ever takes it.
 */
const ROLE_ENTITY_TTL_SECONDS = 300;
const roleEntityKey = (roleId: string) => `role:entity:${roleId}`;
const roleGenKey = (roleId: string) => `role:entity:${roleId}:gen`;

/** What sits in Redis under `role:entity:<id>`. */
interface RoleEntry {
  v: Role;
  gen: string;
}

/** A read of the role cache: the role if its entry is current, and the generation to load under. */
export interface RoleCacheRead {
  role: Role | null;
  gen: string;
}

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

  /** Drops the resolved matrix and the cached role, and bumps the role's generation. */
  async invalidateRole(roleId: string): Promise<void> {
    await this.redis.client
      .multi()
      .incr(roleGenKey(roleId))
      .del(`role:permissions:${roleId}`, roleEntityKey(roleId))
      .exec();
  }

  /**
   * One round trip (`MGET entity gen`). `role` is null on a miss — no entry,
   * an unparseable one, or one from another generation; `gen` is what a load
   * started now must write under. Throws if Redis does not answer.
   */
  async readRole(roleId: string): Promise<RoleCacheRead> {
    const [raw, gen] = await this.redis.client.mget(roleEntityKey(roleId), roleGenKey(roleId));
    const current = gen ?? '0';
    if (!raw) return { role: null, gen: current };
    try {
      const entry = JSON.parse(raw) as RoleEntry;
      return { role: entry?.gen === current && entry.v ? entry.v : null, gen: current };
    } catch {
      return { role: null, gen: current };
    }
  }

  /** Caches a role loaded under `gen` (from `readRole`). */
  async writeRole(role: Role, gen: string): Promise<void> {
    await this.redis.client.set(
      roleEntityKey(role.id),
      JSON.stringify({ v: role, gen } satisfies RoleEntry),
      'EX',
      ROLE_ENTITY_TTL_SECONDS,
    );
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
