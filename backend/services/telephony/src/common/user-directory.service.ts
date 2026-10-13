import { Injectable, Logger, Optional } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { RedisSwrCache } from './redis-swr-cache';
import { LocalTtlCache } from './local-ttl-cache';

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL || 'http://localhost:4001';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
/** Served from Redis without a reload while younger than this. */
const FRESH_MS = 5 * 60_000;
/** Older than fresh but younger than this: served while one reload runs. */
const STALE_MS = 10 * 60_000;
/** In front of Redis, per process — the softphone polls presence often. */
const L1_MS = 15_000;
const CACHE_KEY = 'telephony:user-directory:v1';

/** A teammate a call can be handed to. */
export interface DirectoryUser {
  id: string;
  name: string;
  /** The one field that is unique — two people can share a name. */
  email?: string;
  roleId?: string;
  /** Their own number, when they've set one — the "not at their desk" route. */
  phone?: string;
}

/**
 * The list of people a call can be transferred to or pulled onto (and what
 * presence and the call groups name people from). Read from the user-service
 * internal listing and kept in Redis, shared by every task, with
 * stale-while-revalidate: fresh five minutes, then served while one reload
 * runs, and the last good list served when user-service is failing. A
 * fifteen-second in-process layer sits in front. The picker opens mid-call,
 * so it has to be instant, and the roster barely changes.
 */
@Injectable()
export class UserDirectoryService {
  private readonly logger = new Logger(UserDirectoryService.name);
  private readonly shared: RedisSwrCache<DirectoryUser[]>;
  private readonly local = new LocalTtlCache<DirectoryUser[]>(L1_MS);

  constructor(@Optional() redis?: RedisService) {
    this.shared = new RedisSwrCache<DirectoryUser[]>(redis, CACHE_KEY, {
      freshMs: FRESH_MS,
      staleMs: STALE_MS,
    });
  }

  async list(): Promise<DirectoryUser[]> {
    try {
      return await this.local.get(() => this.shared.get(() => this.load()));
    } catch (error) {
      // Nothing held anywhere and user-service failing: nobody to offer.
      this.logger.warn(
        `user directory failed: ${error instanceof Error ? error.message : error}`,
      );
      return [];
    }
  }

  /** One teammate, for validating a transfer target. */
  async find(userId: string): Promise<DirectoryUser | undefined> {
    return (await this.list()).find((u) => u.id === userId);
  }

  /** The listing from user-service. Throws on failure, so nothing is cached. */
  private async load(): Promise<DirectoryUser[]> {
    const res = await fetch(
      `${USER_SERVICE_URL}/api/users/internal/all?limit=500`,
      { headers: { 'x-internal-secret': INTERNAL_SECRET } },
    );
    if (!res.ok) throw new Error(`user directory returned ${res.status}`);
    const body = (await res.json()) as {
      data?: {
        items?: Array<{
          id: string;
          firstName?: string;
          lastName?: string;
          email?: string;
          roleId?: string;
          phone?: string;
          status?: string;
        }>;
      };
    };
    return (body.data?.items ?? [])
      // Deactivated people shouldn't be offered a live call.
      .filter((u) => u.status !== 'inactive')
      .map((u) => ({
        id: u.id,
        name:
          [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
          u.email ||
          u.id,
        email: u.email,
        roleId: u.roleId,
        phone: u.phone,
      }));
  }
}
