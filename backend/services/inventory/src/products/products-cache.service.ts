import { Injectable } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { type Product } from '@bitcrm/types';

const PREFIX = 'inventory:product:';
const TTL = 300; // 5 minutes

@Injectable()
export class ProductsCacheService {
  constructor(private readonly redis: RedisService) {}

  async get(id: string): Promise<Product | null> {
    const data = await this.redis.client.get(`${PREFIX}${id}`);
    if (!data) return null;
    return JSON.parse(data);
  }

  async set(id: string, product: Product): Promise<void> {
    await this.redis.client.set(
      `${PREFIX}${id}`,
      JSON.stringify(product),
      'EX',
      TTL,
    );
  }

  async invalidate(id: string): Promise<void> {
    await this.redis.client.del(`${PREFIX}${id}`);
  }
}
