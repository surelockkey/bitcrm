import { Injectable } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { type Company } from '@bitcrm/types';

const PREFIX = 'crm:company:';
const TTL = 300;

@Injectable()
export class CompaniesCacheService {
  constructor(private readonly redis: RedisService) {}

  async get(id: string): Promise<Company | null> {
    const data = await this.redis.client.get(`${PREFIX}${id}`);
    if (!data) return null;
    return JSON.parse(data);
  }

  async set(company: Company): Promise<void> {
    await this.redis.client.set(
      `${PREFIX}${company.id}`,
      JSON.stringify(company),
      'EX',
      TTL,
    );
  }

  async invalidate(id: string): Promise<void> {
    await this.redis.client.del(`${PREFIX}${id}`);
  }
}
