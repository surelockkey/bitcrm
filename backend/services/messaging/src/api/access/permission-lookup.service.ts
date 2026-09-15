import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PermissionCacheReader, fetchResolvedPermissions } from '@bitcrm/shared';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';

/** Injection token for the fetch used on a cache miss — swapped in tests. */
export const PERMISSION_FETCH = Symbol('PERMISSION_FETCH');

type PermissionFetch = (userServiceUrl: string, userId: string) => Promise<ResolvedPermissions | null>;

/**
 * Memo short enough that a revoked viewer stops receiving within a minute
 * of the change, long enough that a busy stream does not hit Redis per
 * event. Matches the 60 s TTL of the permission caches underneath.
 */
const MEMO_TTL_MS = 60_000;

/**
 * Resolves a caller's permissions on handlers the `PermissionGuard` never
 * ran (telephony's `PermissionLookupService`, generalised). The SSE stream
 * is such a handler: it needs `messages.view` OR `team_chat.view`, which no
 * single `@RequirePermission` can express, and it must re-check per event
 * because a connection outlives a permission change by hours.
 *
 * Redis first (the same keys the guard reads), then user-service. Every
 * failure path resolves to `null` — a viewer we cannot vouch for gets
 * nothing.
 */
@Injectable()
export class PermissionLookupService {
  private readonly logger = new Logger(PermissionLookupService.name);
  private readonly memo = new Map<string, { resolved: ResolvedPermissions | null; expiresAt: number }>();
  private readonly fetchPermissions: PermissionFetch;

  constructor(
    private readonly cacheReader: PermissionCacheReader,
    @Optional() @Inject(PERMISSION_FETCH) fetchImpl?: PermissionFetch,
  ) {
    this.fetchPermissions = fetchImpl ?? fetchResolvedPermissions;
  }

  async resolve(user: JwtUser | undefined): Promise<ResolvedPermissions | null> {
    if (!user?.id) return null;

    const hit = this.memo.get(user.id);
    if (hit && hit.expiresAt > Date.now()) return hit.resolved;

    let resolved: ResolvedPermissions | null = null;
    try {
      resolved =
        (await this.cacheReader.getPermissions(user.id, user.roleId)) ??
        (await this.fetchPermissions(process.env.USER_SERVICE_URL || 'http://localhost:4001', user.id));
    } catch (error) {
      this.logger.warn(
        `Could not resolve permissions for ${user.id}: ${error instanceof Error ? error.message : error}`,
      );
      resolved = null;
    }

    this.memo.set(user.id, { resolved, expiresAt: Date.now() + MEMO_TTL_MS });
    return resolved;
  }
}
