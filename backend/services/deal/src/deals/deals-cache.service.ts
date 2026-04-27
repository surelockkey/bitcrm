import { Injectable } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { type Deal } from '@bitcrm/types';

const PREFIX = 'deal:';
const TTL = 300; // 5 minutes

@Injectable()
export class DealsCacheService {
  constructor(private readonly redis: RedisService) {}

  async get(id: string): Promise<Deal | null> {
    const data = await this.redis.client.get(`${PREFIX}${id}`);
    if (!data) return null;
    return JSON.parse(data);
  }

  async set(deal: Deal): Promise<void> {
    await this.redis.client.set(
      `${PREFIX}${deal.id}`,
      JSON.stringify(deal),
      'EX',
      TTL,
    );
  }

  async invalidate(id: string): Promise<void> {
    await this.redis.client.del(`${PREFIX}${id}`);
  }
}
