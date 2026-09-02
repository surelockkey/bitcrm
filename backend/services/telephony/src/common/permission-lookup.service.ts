import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  PermissionCacheReader,
  fetchResolvedPermissions,
  hasPermission,
} from '@bitcrm/shared';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL || 'http://localhost:4001';

/**
 * Short enough that a manager flipping the toggle sees it take effect while
 * they are still looking at the screen; long enough that the softphone's 5s
 * poll of /calls/active does not resolve permissions twelve times a minute.
 * Matches the 60s TTL on the Redis permission caches underneath.
 */
const MEMO_TTL_MS = 60_000;

/** Injection token for the fetch used on a cache miss — swapped in tests. */
export const PERMISSION_FETCH = Symbol('PERMISSION_FETCH');

type PermissionFetch = (
  userServiceUrl: string,
  userId: string,
) => Promise<ResolvedPermissions | null>;

/**
 * Answers "may this viewer see client phone numbers?" for handlers that
 * `PermissionGuard` never ran.
 *
 * `GET /calls/active`, `/calls/identify` and `/calls/recent` carry no
 * `@RequirePermission` — the guard returns true at the top without resolving
 * anything, so `request.resolvedPermissions` is undefined on exactly the
 * endpoints a masked technician uses most. They also cannot simply gain
 * `@RequirePermission('calls', 'view')`, which technicians do not hold.
 *
 * So this resolves explicitly: Redis first (the same keys the guard reads),
 * then user-service. Every failure path returns false — a viewer we cannot
 * vouch for does not get numbers.
 */
@Injectable()
export class PermissionLookupService {
  private readonly logger = new Logger(PermissionLookupService.name);
  private readonly memo = new Map<string, { allowed: boolean; expiresAt: number }>();
  private readonly fetchPermissions: PermissionFetch;

  constructor(
    private readonly cacheReader: PermissionCacheReader,
    @Optional()
    @Inject(PERMISSION_FETCH)
    fetchImpl?: PermissionFetch,
  ) {
    this.fetchPermissions = fetchImpl ?? fetchResolvedPermissions;
  }

  /** Does this user hold `contacts.view_numbers`? */
  async maySeeClientNumbers(user: JwtUser | undefined): Promise<boolean> {
    if (!user?.id) return false;

    const hit = this.memo.get(user.id);
    if (hit && hit.expiresAt > Date.now()) return hit.allowed;

    let allowed = false;
    try {
      const resolved =
        (await this.cacheReader.getPermissions(user.id, user.roleId)) ??
        (await this.fetchPermissions(USER_SERVICE_URL, user.id));
      allowed = hasPermission(resolved, 'contacts', 'view_numbers');
    } catch (error) {
      // Fail closed, and say so — a masked call log is a visible symptom and
      // somebody will ask why.
      this.logger.warn(
        `Could not resolve contacts.view_numbers for ${user.id}, masking numbers: ${
          error instanceof Error ? error.message : error
        }`,
      );
      allowed = false;
    }

    this.memo.set(user.id, { allowed, expiresAt: Date.now() + MEMO_TTL_MS });
    return allowed;
  }
}
