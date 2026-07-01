import { Injectable } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { type TechnicianProfile } from '@bitcrm/types';

const PROFILE_PREFIX = 'technician:';
const TTL = 300; // 5 minutes

@Injectable()
export class TechniciansCacheService {
  constructor(private readonly redis: RedisService) {}

  async getProfile(userId: string): Promise<TechnicianProfile | null> {
    const data = await this.redis.client.get(`${PROFILE_PREFIX}${userId}`);
    if (!data) return null;
    return JSON.parse(data);
  }

  async setProfile(profile: TechnicianProfile): Promise<void> {
    await this.redis.client.set(
      `${PROFILE_PREFIX}${profile.userId}`,
      JSON.stringify(profile),
      'EX',
      TTL,
    );
  }

  async invalidateProfile(userId: string): Promise<void> {
    await this.redis.client.del(`${PROFILE_PREFIX}${userId}`);
  }
}
