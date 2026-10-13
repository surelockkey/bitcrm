import { Injectable } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { type Contact } from '@bitcrm/types';

const PREFIX = 'crm:contact:';
const TTL = 300;

@Injectable()
export class ContactsCacheService {
  constructor(private readonly redis: RedisService) {}

  async get(id: string): Promise<Contact | null> {
    const data = await this.redis.client.get(`${PREFIX}${id}`);
    if (!data) return null;
    return JSON.parse(data);
  }

  async set(contact: Contact): Promise<void> {
    await this.redis.client.set(
      `${PREFIX}${contact.id}`,
      JSON.stringify(contact),
      'EX',
      TTL,
    );
  }

  /** Every cached contact of these ids, in one MGET; misses are simply absent. */
  async getMany(ids: string[]): Promise<Map<string, Contact>> {
    const hits = new Map<string, Contact>();
    if (ids.length === 0) return hits;
    const raw = await this.redis.client.mget(...ids.map((id) => `${PREFIX}${id}`));
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
    await pipeline.exec();
  }

  async invalidate(id: string): Promise<void> {
    await this.redis.client.del(`${PREFIX}${id}`);
  }
}
