import { Injectable } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { type Product } from '@bitcrm/types';

const PREFIX = 'inventory:product:';
const TTL = 300; // 5 minutes

/**
 * The Redis key one product is cached under. Exported so StockRepository can
 * drop it after moving `onHand` without depending on this service.
 */
export function productCacheKey(id: string): string {
  return `${PREFIX}${id}`;
}

@Injectable()
export class ProductsCacheService {
  constructor(private readonly redis: RedisService) {}

  async get(id: string): Promise<Product | null> {
    const data = await this.redis.client.get(productCacheKey(id));
    if (!data) return null;
    return JSON.parse(data);
  }

  async set(id: string, product: Product): Promise<void> {
    await this.redis.client.set(
      productCacheKey(id),
      JSON.stringify(product),
      'EX',
      TTL,
    );
  }

  /** Every cached product of these ids, in one MGET; misses are simply absent. */
  async getMany(ids: string[]): Promise<Map<string, Product>> {
    const hits = new Map<string, Product>();
    if (ids.length === 0) return hits;
    const raw = await this.redis.client.mget(...ids.map(productCacheKey));
    raw.forEach((data, i) => {
      if (data) hits.set(ids[i], JSON.parse(data) as Product);
    });
    return hits;
  }

  /** Caches each product under its own key (same TTL as `set`). */
  async setMany(products: Product[]): Promise<void> {
    await Promise.all(products.map((p) => this.set(p.id, p)));
  }

  async invalidate(id: string): Promise<void> {
    await this.redis.client.del(productCacheKey(id));
  }
}
