import { Injectable, Logger } from '@nestjs/common';
import { RedisService, failOpen } from '@bitcrm/shared';
import { type User } from '@bitcrm/types';

const USER_PREFIX = 'user:';
const TTL = 300; // 5 minutes

@Injectable()
export class UsersCacheService {
  private readonly logger = new Logger(UsersCacheService.name);
  /** Redis gone (a deploy's outgoing task, a failover): a miss, or a dropped write — the TTL bounds staleness. */
  private readonly lost = (error: Error) => this.logger.warn(`cache unavailable: ${error.message}`);

  constructor(private readonly redis: RedisService) {}

  async getUser(id: string): Promise<User | null> {
    const data = await failOpen(() => this.redis.client.get(`${USER_PREFIX}${id}`), null, this.lost);
    if (!data) return null;
    return JSON.parse(data);
  }

  async setUser(user: User): Promise<void> {
    await failOpen(
      () => this.redis.client.set(`${USER_PREFIX}${user.id}`, JSON.stringify(user), 'EX', TTL),
      null,
      this.lost,
    );
  }

  async invalidateUser(id: string): Promise<void> {
    await failOpen(() => this.redis.client.del(`${USER_PREFIX}${id}`), 0, this.lost);
  }
}
