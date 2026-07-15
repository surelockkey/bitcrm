import { Injectable } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { type TechnicianLocation } from '@bitcrm/types';

const PREFIX = 'tech:location:';

export interface LocationInput {
  lat: number;
  lng: number;
  accuracy?: number;
}

/**
 * Technician positions, self-reported while online.
 *
 * The last known fix is kept indefinitely (until the next one overwrites it), so
 * the dispatch map always shows where a technician was last seen and how long
 * ago. "Online" vs "last seen" is a question the reader answers from the
 * timestamp — the record itself doesn't expire.
 */
@Injectable()
export class TechnicianLocationService {
  constructor(private readonly redis: RedisService) {}

  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async setLocation(
    userId: string,
    input: LocationInput,
  ): Promise<TechnicianLocation> {
    const location: TechnicianLocation = {
      userId,
      lat: input.lat,
      lng: input.lng,
      accuracy: input.accuracy,
      updatedAt: new Date().toISOString(),
    };

    // No expiry — the last location is kept until a newer one replaces it.
    await this.redis.client.set(this.key(userId), JSON.stringify(location));

    return location;
  }

  async getLocation(userId: string): Promise<TechnicianLocation | null> {
    const raw = await this.redis.client.get(this.key(userId));
    return raw ? (JSON.parse(raw) as TechnicianLocation) : null;
  }

  async clearLocation(userId: string): Promise<void> {
    await this.redis.client.del(this.key(userId));
  }

  /** Every technician currently online, for the dispatch map. */
  async listLocations(): Promise<TechnicianLocation[]> {
    const keys = await this.redis.client.keys(`${PREFIX}*`);
    if (keys.length === 0) return [];

    const raw = await this.redis.client.mget(...keys);
    return raw
      .filter((v): v is string => v !== null)
      .map((v) => JSON.parse(v) as TechnicianLocation);
  }
}
