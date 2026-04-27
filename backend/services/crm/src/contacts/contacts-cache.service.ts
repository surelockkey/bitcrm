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

  async invalidate(id: string): Promise<void> {
    await this.redis.client.del(`${PREFIX}${id}`);
  }
}
