import { Injectable } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { type User } from '@bitcrm/types';

const USER_PREFIX = 'user:';
const TTL = 300; // 5 minutes

@Injectable()
export class UsersCacheService {
  constructor(private readonly redis: RedisService) {}

  async getUser(id: string): Promise<User | null> {
    const data = await this.redis.client.get(`${USER_PREFIX}${id}`);
    if (!data) return null;
    return JSON.parse(data);
  }

  async setUser(user: User): Promise<void> {
    await this.redis.client.set(
      `${USER_PREFIX}${user.id}`,
      JSON.stringify(user),
      'EX',
      TTL,
    );
  }

  async invalidateUser(id: string): Promise<void> {
    await this.redis.client.del(`${USER_PREFIX}${id}`);
  }
}
