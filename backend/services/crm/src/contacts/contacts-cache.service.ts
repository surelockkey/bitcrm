import { Injectable, Logger } from '@nestjs/common';
import { RedisService, failOpen } from '@bitcrm/shared';
import { type Contact } from '@bitcrm/types';

const PREFIX = 'crm:contact:';
const TTL = 300;

@Injectable()
export class ContactsCacheService {
  private readonly logger = new Logger(ContactsCacheService.name);
  /** Redis gone (a deploy's outgoing task, a failover): a miss, or a dropped write — the TTL bounds staleness. */
  private readonly lost = (error: Error) => this.logger.warn(`cache unavailable: ${error.message}`);

  constructor(private readonly redis: RedisService) {}

  async get(id: string): Promise<Contact | null> {
    const data = await failOpen(() => this.redis.client.get(`${PREFIX}${id}`), null, this.lost);
    if (!data) return null;
    return JSON.parse(data);
  }

  async set(contact: Contact): Promise<void> {
    await failOpen(
      () => this.redis.client.set(`${PREFIX}${contact.id}`, JSON.stringify(contact), 'EX', TTL),
      null,
      this.lost,
    );
  }

  /** Every cached contact of these ids, in one MGET; misses are simply absent. */
  async getMany(ids: string[]): Promise<Map<string, Contact>> {
    const hits = new Map<string, Contact>();
    if (ids.length === 0) return hits;
    const raw = await failOpen(
      () => this.redis.client.mget(...ids.map((id) => `${PREFIX}${id}`)),
      [] as (string | null)[],
      this.lost,
    );
    raw.forEach((data, i) => {
      if (data) hits.set(ids[i], JSON.parse(data) as Contact);
    });
    return hits;
  }

  /** Caches each contact under its own key (same TTL as `set`), in one pipeline. */
  async setMany(contacts: Contact[]): Promise<void> {
    if (contacts.length === 0) return;
    const pipeline = this.redis.client.pipeline();
    for (const c of contacts) pipeline.set(`${PREFIX}${c.id}`, JSON.stringify(c), 'EX', TTL);
    await failOpen(() => pipeline.exec(), null, this.lost);
  }

  async invalidate(id: string): Promise<void> {
    await failOpen(() => this.redis.client.del(`${PREFIX}${id}`), 0, this.lost);
  }
}
