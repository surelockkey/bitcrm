import { Injectable, Logger } from '@nestjs/common';

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL || 'http://localhost:4001';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
const CACHE_TTL_MS = 60_000;

/** A teammate a call can be handed to. */
export interface DirectoryUser {
  id: string;
  name: string;
  roleId?: string;
  /** Their own number, when they've set one — the "not at their desk" route. */
  phone?: string;
}

/**
 * The list of people a call can be transferred to or pulled onto. Read from
 * the user-service internal listing and cached briefly: the picker opens
 * mid-call, so it has to be instant, and the roster barely changes.
 */
@Injectable()
export class UserDirectoryService {
  private readonly logger = new Logger(UserDirectoryService.name);
  private cache: { users: DirectoryUser[]; expiresAt: number } | null = null;

  async list(): Promise<DirectoryUser[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.users;

    try {
      const res = await fetch(
        `${USER_SERVICE_URL}/api/users/internal/all?limit=500`,
        { headers: { 'x-internal-secret': INTERNAL_SECRET } },
      );
      if (!res.ok) {
        this.logger.warn(`user directory returned ${res.status}`);
        return this.cache?.users ?? [];
      }
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
      const users = (body.data?.items ?? [])
        // Deactivated people shouldn't be offered a live call.
        .filter((u) => u.status !== 'inactive')
        .map((u) => ({
          id: u.id,
          name:
            [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
            u.email ||
            u.id,
          roleId: u.roleId,
          phone: u.phone,
        }));
      this.cache = { users, expiresAt: Date.now() + CACHE_TTL_MS };
      return users;
    } catch (error) {
      this.logger.warn(
        `user directory failed: ${error instanceof Error ? error.message : error}`,
      );
      return this.cache?.users ?? [];
    }
  }

  /** One teammate, for validating a transfer target. */
  async find(userId: string): Promise<DirectoryUser | undefined> {
    return (await this.list()).find((u) => u.id === userId);
  }
}
