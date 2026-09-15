import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';

/** Injection token for the HTTP fetch — swapped in unit tests. */
export const USER_FETCH = Symbol('USER_FETCH');

/** The little the inbox needs to know about a teammate. */
export interface UserSummary {
  id: string;
  name: string;
  email?: string;
  roleId?: string;
  status?: string;
}

const CACHE_TTL_MS = 60_000;

type Fetch = typeof fetch;

/**
 * "Does this user exist?" for assignment, answered by user-service's
 * `GET /users/internal/:id`. A 404 is a definite no; anything else that is
 * not a 200 is a 503 to the caller — assigning a thread to an id nobody can
 * vouch for is worse than asking them to retry.
 */
@Injectable()
export class UserLookupService {
  private readonly logger = new Logger(UserLookupService.name);
  private readonly cache = new Map<string, { user: UserSummary | null; expiresAt: number }>();
  private readonly fetchImpl: Fetch;

  constructor(@Optional() @Inject(USER_FETCH) fetchImpl?: Fetch) {
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /** `null` = no such user. Throws `ServiceUnavailableException` when user-service cannot answer. */
  async find(userId: string): Promise<UserSummary | null> {
    if (!userId) return null;
    const hit = this.cache.get(userId);
    if (hit && hit.expiresAt > Date.now()) return hit.user;

    const base = process.env.USER_SERVICE_URL || 'http://localhost:4001';
    let res: Response;
    try {
      res = await this.fetchImpl(`${base}/api/users/internal/${encodeURIComponent(userId)}`, {
        headers: { 'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET || '' },
      });
    } catch (error) {
      this.logger.warn(`user ${userId} lookup failed: ${error instanceof Error ? error.message : error}`);
      throw new ServiceUnavailableException('User service unreachable');
    }

    if (res.status === 404) {
      this.cache.set(userId, { user: null, expiresAt: Date.now() + CACHE_TTL_MS });
      return null;
    }
    if (!res.ok) {
      this.logger.warn(`user ${userId} lookup returned ${res.status}`);
      throw new ServiceUnavailableException('User service unreachable');
    }

    const body = (await res.json()) as {
      data?: { id: string; firstName?: string; lastName?: string; email?: string; roleId?: string; status?: string };
    };
    const u = body.data;
    if (!u) return null;
    const user: UserSummary = {
      id: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || u.id,
      email: u.email,
      roleId: u.roleId,
      status: u.status,
    };
    this.cache.set(userId, { user, expiresAt: Date.now() + CACHE_TTL_MS });
    return user;
  }
}
