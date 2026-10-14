import { Injectable, Logger } from '@nestjs/common';
import { RedisService, failOpen } from '@bitcrm/shared';
import { type Company } from '@bitcrm/types';

const PREFIX = 'crm:company:';
const TTL = 300;

@Injectable()
export class CompaniesCacheService {
  private readonly logger = new Logger(CompaniesCacheService.name);
  /** Redis gone (a deploy's outgoing task, a failover): a miss, or a dropped write — the TTL bounds staleness. */
  private readonly lost = (error: Error) => this.logger.warn(`cache unavailable: ${error.message}`);

  constructor(private readonly redis: RedisService) {}

  async get(id: string): Promise<Company | null> {
    const data = await failOpen(() => this.redis.client.get(`${PREFIX}${id}`), null, this.lost);
    if (!data) return null;
    return JSON.parse(data);
  }

  async set(company: Company): Promise<void> {
    await failOpen(
      () => this.redis.client.set(`${PREFIX}${company.id}`, JSON.stringify(company), 'EX', TTL),
      null,
      this.lost,
    );
  }

  async invalidate(id: string): Promise<void> {
    await failOpen(() => this.redis.client.del(`${PREFIX}${id}`), 0, this.lost);
  }
}
