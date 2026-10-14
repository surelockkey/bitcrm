import { Injectable, Logger } from '@nestjs/common';
import { RedisService, failOpen } from '@bitcrm/shared';
import { type TechnicianProfile } from '@bitcrm/types';

const PROFILE_PREFIX = 'technician:';
const TTL = 300; // 5 minutes

@Injectable()
export class TechniciansCacheService {
  private readonly logger = new Logger(TechniciansCacheService.name);
  /** Redis gone (a deploy's outgoing task, a failover): a miss, or a dropped write — the TTL bounds staleness. */
  private readonly lost = (error: Error) => this.logger.warn(`cache unavailable: ${error.message}`);

  constructor(private readonly redis: RedisService) {}

  async getProfile(userId: string): Promise<TechnicianProfile | null> {
    const data = await failOpen(() => this.redis.client.get(`${PROFILE_PREFIX}${userId}`), null, this.lost);
    if (!data) return null;
    return JSON.parse(data);
  }

  async setProfile(profile: TechnicianProfile): Promise<void> {
    await failOpen(
      () => this.redis.client.set(`${PROFILE_PREFIX}${profile.userId}`, JSON.stringify(profile), 'EX', TTL),
      null,
      this.lost,
    );
  }

  async invalidateProfile(userId: string): Promise<void> {
    await failOpen(() => this.redis.client.del(`${PROFILE_PREFIX}${userId}`), 0, this.lost);
  }
}
